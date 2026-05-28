"""Migrate a local PostgreSQL (ERP) database to DynamoDB.

For every table in the source schema this script:
  1. Detects the primary-key column(s) automatically.
  2. Streams all rows from PostgreSQL.
  3. Writes each row to the matching DynamoDB table, skipping records
     that already exist (conditional put — never overwrites).

Usage
-----
    # Staging account
    export AWS_PROFILE=nse-staging
    STAGE=staging PG_DSN="postgresql://user:pass@localhost/erp_db" \\
        python3 infrastructure/scripts/pg_to_dynamo.py

    # Prod account
    export AWS_PROFILE=nse-prod
    STAGE=prod PG_DSN="postgresql://user:pass@localhost/erp_db" \\
        python3 infrastructure/scripts/pg_to_dynamo.py

    # Dry run — print what would be migrated without writing anything
    DRY_RUN=1 PG_DSN="postgresql://user:pass@localhost/erp_db" \\
        python3 infrastructure/scripts/pg_to_dynamo.py

Environment variables
---------------------
    PG_DSN          PostgreSQL connection string (required)
    STAGE           staging | prod  (default: staging)
    AWS_REGION      default: ap-south-1
    DRY_RUN         set to 1 to print rows without writing to DynamoDB
    PG_SCHEMA       PostgreSQL schema to scan  (default: public)
    SKIP_TABLES     comma-separated table names to skip entirely
    BATCH_SIZE      rows to buffer per DynamoDB batch  (default: 25, max 25)

Dependencies
------------
    pip install psycopg2-binary boto3
"""

import decimal
import json
import os
import sys
import datetime
from typing import Any

# ── Optional dependency check ─────────────────────────────────────────────────
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 not installed.  Run: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)

try:
    import boto3
    from boto3.dynamodb.conditions import Attr
    from botocore.exceptions import ClientError
except ImportError:
    print("ERROR: boto3 not installed.  Run: pip install boto3", file=sys.stderr)
    sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────
PG_DSN      = os.environ.get("PG_DSN", "")
STAGE       = os.environ.get("STAGE", "staging").lower()
REGION      = os.environ.get("AWS_REGION", "ap-south-1")
DRY_RUN     = os.environ.get("DRY_RUN", "0") == "1"
PG_SCHEMA   = os.environ.get("PG_SCHEMA", "public")
SKIP_TABLES = {t.strip() for t in os.environ.get("SKIP_TABLES", "").split(",") if t.strip()}
BATCH_SIZE  = min(int(os.environ.get("BATCH_SIZE", "25")), 25)  # DynamoDB max = 25

if not PG_DSN:
    print("ERROR: PG_DSN is required.  Example:", file=sys.stderr)
    print('  PG_DSN="postgresql://user:pass@localhost/mydb" python3 pg_to_dynamo.py', file=sys.stderr)
    sys.exit(1)

if STAGE not in ("staging", "prod"):
    print(f"ERROR: STAGE must be staging or prod — got '{STAGE}'", file=sys.stderr)
    sys.exit(1)


# ── Type conversion: PostgreSQL → DynamoDB ────────────────────────────────────

def _to_dynamo(value: Any) -> Any:
    """Convert a PostgreSQL column value to a DynamoDB-safe type."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return value
    if isinstance(value, float):
        return decimal.Decimal(str(value))
    if isinstance(value, int):
        return decimal.Decimal(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value)
    if isinstance(value, (list, tuple)):
        converted = [_to_dynamo(v) for v in value]
        return [v for v in converted if v is not None]
    if isinstance(value, dict):
        return {k: _to_dynamo(v) for k, v in value.items() if _to_dynamo(v) is not None}
    return str(value)


def row_to_item(row: dict) -> dict:
    """Convert a psycopg2 RealDictRow to a DynamoDB item dict.

    None values are dropped — DynamoDB does not allow NULL attributes.
    """
    item = {}
    for col, val in row.items():
        converted = _to_dynamo(val)
        if converted is not None:
            item[col] = converted
    return item


# ── PostgreSQL helpers ────────────────────────────────────────────────────────

def get_tables(cur, schema: str) -> list[str]:
    """Return all user tables in the given PostgreSQL schema."""
    cur.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = %s
          AND table_type   = 'BASE TABLE'
        ORDER BY table_name
        """,
        (schema,),
    )
    return [r["table_name"] for r in cur.fetchall()]


def get_pk_columns(cur, schema: str, table: str) -> list[str]:
    """Return primary-key column names for a table, in key order."""
    cur.execute(
        """
        SELECT kcu.column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage  AS kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema    = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema    = %s
          AND tc.table_name      = %s
        ORDER BY kcu.ordinal_position
        """,
        (schema, table),
    )
    return [r["column_name"] for r in cur.fetchall()]


def stream_rows(cur, schema: str, table: str):
    """Yield all rows from a table as RealDictRow objects."""
    cur.execute(f'SELECT * FROM "{schema}"."{table}"')
    while True:
        rows = cur.fetchmany(500)
        if not rows:
            break
        yield from rows


# ── DynamoDB helpers ──────────────────────────────────────────────────────────

def dynamo_table(resource, name: str):
    """Return a boto3 DynamoDB Table resource, or None if the table doesn't exist."""
    try:
        tbl = resource.Table(name)
        tbl.load()
        return tbl
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ResourceNotFoundException":
            return None
        raise


def put_if_not_exists(table, item: dict, pk_cols: list[str]) -> str:
    """Write item to DynamoDB only if the PK does not already exist.

    Returns:
        "written"  — item was new and has been inserted.
        "skipped"  — item already existed; left unchanged.
        "error"    — unexpected error (printed to stderr).
    """
    condition = None
    for col in pk_cols:
        expr = Attr(col).not_exists()
        condition = expr if condition is None else condition & expr

    try:
        table.put_item(Item=item, ConditionExpression=condition)
        return "written"
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return "skipped"
        print(f"  ERROR putting item {_pk_str(item, pk_cols)}: {exc}", file=sys.stderr)
        return "error"


def _pk_str(item: dict, pk_cols: list[str]) -> str:
    return ", ".join(f"{c}={item.get(c)}" for c in pk_cols)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    mode = "DRY RUN" if DRY_RUN else f"LIVE (stage={STAGE})"
    print()
    print("=" * 62)
    print(f"  PostgreSQL → DynamoDB migration   [{mode}]")
    print(f"  Schema : {PG_SCHEMA}   Region : {REGION}")
    print("=" * 62)
    print()

    # Connect to PostgreSQL
    try:
        pg_conn = psycopg2.connect(PG_DSN, cursor_factory=psycopg2.extras.RealDictCursor)
        pg_conn.set_session(readonly=True, autocommit=True)
    except Exception as exc:
        print(f"ERROR: Cannot connect to PostgreSQL — {exc}", file=sys.stderr)
        sys.exit(1)

    # Connect to DynamoDB
    dynamo = None if DRY_RUN else boto3.resource("dynamodb", region_name=REGION)

    cur = pg_conn.cursor()
    tables = get_tables(cur, PG_SCHEMA)

    if not tables:
        print(f"No tables found in schema '{PG_SCHEMA}'.")
        sys.exit(0)

    print(f"Found {len(tables)} table(s): {', '.join(tables)}")
    if SKIP_TABLES:
        print(f"Skipping: {', '.join(sorted(SKIP_TABLES))}")
    print()

    total_written = total_skipped = total_errors = total_missing = 0

    for table_name in tables:
        if table_name in SKIP_TABLES:
            print(f"  [{table_name}]  — skipped (SKIP_TABLES)")
            continue

        pk_cols = get_pk_columns(cur, PG_SCHEMA, table_name)
        if not pk_cols:
            print(f"  [{table_name}]  — WARNING: no primary key detected, skipping")
            continue

        # Check DynamoDB table exists
        ddb_table = None
        if not DRY_RUN:
            ddb_table = dynamo_table(dynamo, table_name)
            if ddb_table is None:
                print(f"  [{table_name}]  — DynamoDB table '{table_name}' not found, skipping")
                total_missing += 1
                continue

        print(f"  [{table_name}]  PK={pk_cols}", end="  ", flush=True)

        written = skipped = errors = row_count = 0

        for row in stream_rows(cur, PG_SCHEMA, table_name):
            row_count += 1
            item = row_to_item(dict(row))

            if DRY_RUN:
                if row_count <= 2:
                    print()
                    print(f"    sample: {json.dumps(item, default=str)[:120]}")
                written += 1
                continue

            result = put_if_not_exists(ddb_table, item, pk_cols)
            if result == "written":
                written += 1
            elif result == "skipped":
                skipped += 1
            else:
                errors += 1

        print(f"rows={row_count}  written={written}  skipped={skipped}  errors={errors}")
        total_written  += written
        total_skipped  += skipped
        total_errors   += errors

    print()
    print("=" * 62)
    print(f"  DONE   written={total_written}  skipped={total_skipped}  "
          f"errors={total_errors}  missing_tables={total_missing}")
    print("=" * 62)
    print()

    pg_conn.close()

    if total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
