"""Create all DynamoDB tables for the NSE Stock Dashboard.

Run from the project root (AWS CLI or instance profile must be configured):

    # Create tables for one stage
    STAGE=dev  python3 infrastructure/dynamodb/create_tables.py
    STAGE=qc   python3 infrastructure/dynamodb/create_tables.py
    STAGE=prod python3 infrastructure/dynamodb/create_tables.py  # no prefix

    # Or via Makefile (uses STAGE variable)
    make dynamo-tables           # defaults to STAGE=dev
    make dynamo-tables STAGE=prod

Table naming:
    dev  →  dev_{name}    (e.g. dev_users, dev_scraping_tasks)
    qc   →  qc_{name}     (e.g. qc_users,  qc_scraping_tasks)
    prod →  {name}         (e.g. users,     scraping_tasks)

All tables use on-demand billing (PAY_PER_REQUEST) — no capacity planning
needed and cost is zero within the DynamoDB Free Tier (25 GB storage,
25 RCU + 25 WCU per month).
"""

import os
import sys

import boto3
from botocore.exceptions import ClientError

REGION = os.environ.get("AWS_REGION", "ap-south-1")
STAGE  = os.environ.get("STAGE", "dev").lower()

if STAGE not in ("dev", "qc", "prod"):
    print(f"ERROR: STAGE must be dev, qc, or prod — got '{STAGE}'", file=sys.stderr)
    sys.exit(1)

# prod tables have no prefix; dev/qc tables use "{stage}_" prefix
PREFIX = "" if STAGE == "prod" else f"{STAGE}_"

db = boto3.client("dynamodb", region_name=REGION)


def _tname(base: str) -> str:
    """Return the stage-prefixed table name."""
    return f"{PREFIX}{base}"


def create_table(name: str, key_schema: list, attribute_defs: list, gsi: list = None) -> None:
    """Create one DynamoDB table, silently skip if it already exists.

    Args:
        name:            Logical table name (will be prefixed by stage).
        key_schema:      DynamoDB KeySchema list.
        attribute_defs:  DynamoDB AttributeDefinitions list.
        gsi:             Optional list of GlobalSecondaryIndex definitions.
    """
    full_name = _tname(name)
    kwargs = {
        "TableName": full_name,
        "KeySchema": key_schema,
        "AttributeDefinitions": attribute_defs,
        "BillingMode": "PAY_PER_REQUEST",
    }
    if gsi:
        kwargs["GlobalSecondaryIndexes"] = gsi

    try:
        db.create_table(**kwargs)
        print(f"  Creating → {full_name} ...")
        db.get_waiter("table_exists").wait(TableName=full_name)
        print(f"  ACTIVE   ✓ {full_name}")
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ResourceInUseException":
            print(f"  EXISTS   – {full_name} (skipped)")
        else:
            raise


def main() -> None:
    """Create all 13 DynamoDB tables for the NSE Stock Dashboard."""
    print(f"Creating DynamoDB tables — stage={STAGE}  prefix='{PREFIX}'  region={REGION}")
    print("=" * 60)

    # ── Users ─────────────────────────────────────────────────────────────────
    # PK: user_id (UUID)
    # GSI username-index: fast login lookup by username
    # GSI email-index:    duplicate-email check at registration
    create_table(
        name="users",
        key_schema=[{"AttributeName": "user_id", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "user_id",  "AttributeType": "S"},
            {"AttributeName": "username", "AttributeType": "S"},
            {"AttributeName": "email",    "AttributeType": "S"},
        ],
        gsi=[
            {
                "IndexName": "username-index",
                "KeySchema": [{"AttributeName": "username", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "email-index",
                "KeySchema": [{"AttributeName": "email", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )

    # ── Stock Transactions ─────────────────────────────────────────────────────
    # PK: txn_id (UUID)
    # GSI user-transactions-index: fetch all transactions for a user (portfolio calc)
    create_table(
        name="stock_transactions",
        key_schema=[{"AttributeName": "txn_id", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "txn_id",  "AttributeType": "S"},
            {"AttributeName": "user_id", "AttributeType": "S"},
        ],
        gsi=[
            {
                "IndexName": "user-transactions-index",
                "KeySchema": [{"AttributeName": "user_id", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )

    # ── Stock Watchlist ────────────────────────────────────────────────────────
    # PK: wl_id (UUID)
    # GSI user-watchlist-index: list all items for a user
    # GSI user-symbol-index:    check whether a symbol is already in a watchlist
    create_table(
        name="stock_watchlist",
        key_schema=[{"AttributeName": "wl_id", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "wl_id",   "AttributeType": "S"},
            {"AttributeName": "user_id", "AttributeType": "S"},
            {"AttributeName": "symbol",  "AttributeType": "S"},
        ],
        gsi=[
            {
                "IndexName": "user-watchlist-index",
                "KeySchema": [{"AttributeName": "user_id", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "user-symbol-index",
                "KeySchema": [
                    {"AttributeName": "user_id", "KeyType": "HASH"},
                    {"AttributeName": "symbol",  "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "KEYS_ONLY"},
            },
        ],
    )

    # ── Scraping Jobs ──────────────────────────────────────────────────────────
    # PK: job_id (UUID) — top-level job created per user request
    # GSI user-jobs-index: list all jobs submitted by a user
    create_table(
        name="scraping_jobs",
        key_schema=[{"AttributeName": "job_id", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "job_id",  "AttributeType": "S"},
            {"AttributeName": "user_id", "AttributeType": "S"},
        ],
        gsi=[
            {
                "IndexName": "user-jobs-index",
                "KeySchema": [{"AttributeName": "user_id", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )

    # ── Scraping Tasks ─────────────────────────────────────────────────────────
    # PK: task_id (UUID) — one task per ASIN/URL within a job
    # GSI job-tasks-index:  list all tasks belonging to a job
    # GSI status-index:     find pending/running tasks (replaces full table scan)
    create_table(
        name="scraping_tasks",
        key_schema=[{"AttributeName": "task_id", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "task_id", "AttributeType": "S"},
            {"AttributeName": "job_id",  "AttributeType": "S"},
            {"AttributeName": "status",  "AttributeType": "S"},
        ],
        gsi=[
            {
                "IndexName": "job-tasks-index",
                "KeySchema": [{"AttributeName": "job_id", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "status-index",
                "KeySchema": [{"AttributeName": "status", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )

    # ── Product Data (scraping results) ───────────────────────────────────────
    # PK: task_id (same UUID as the parent task — 1:1 relationship)
    # Special record: task_id="nse_universe" stores the full NSE equity list
    #   written by the universe-refresh Lambda daily.
    create_table(
        name="product_data",
        key_schema=[{"AttributeName": "task_id", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "task_id", "AttributeType": "S"},
        ],
    )

    # ── Screener Cache ─────────────────────────────────────────────────────────
    # PK: cache_key (e.g. "screener:0.000:50.0")
    # Written every 30 min by screener-refresh Lambda during market hours.
    # The /stocks/screener API endpoint reads from here to avoid real-time
    # 70-second computation on each request.
    create_table(
        name="screener_cache",
        key_schema=[{"AttributeName": "cache_key", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "cache_key", "AttributeType": "S"},
        ],
    )

    # ── Menus ──────────────────────────────────────────────────────────────────
    # PK: menu_id (UUID)
    # GSI path-index:   lookup menu by unique URL path slug
    # GSI parent-index: fetch all child menus of a parent menu
    create_table(
        name="menus",
        key_schema=[{"AttributeName": "menu_id", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "menu_id",   "AttributeType": "S"},
            {"AttributeName": "path",      "AttributeType": "S"},
            {"AttributeName": "parent_id", "AttributeType": "S"},
        ],
        gsi=[
            {
                "IndexName": "path-index",
                "KeySchema": [{"AttributeName": "path", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "parent-index",
                "KeySchema": [{"AttributeName": "parent_id", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )

    # ── Menu Access ────────────────────────────────────────────────────────────
    # PK: access_id (UUID)
    # GSI menu-index: all permission rows for a given menu
    # GSI role-index: all menus accessible by a given role
    create_table(
        name="menu_access",
        key_schema=[{"AttributeName": "access_id", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "access_id", "AttributeType": "S"},
            {"AttributeName": "menu_id",   "AttributeType": "S"},
            {"AttributeName": "role",      "AttributeType": "S"},
        ],
        gsi=[
            {
                "IndexName": "menu-index",
                "KeySchema": [{"AttributeName": "menu_id", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "role-index",
                "KeySchema": [{"AttributeName": "role", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )

    # ── Email Messages ─────────────────────────────────────────────────────────
    # PK: message_id (UUID)
    # GSI uid-index:      lookup by IMAP message UID (unique per mailbox folder)
    # GSI status-index:   filter by processing status (pending / done / replied)
    # GSI category-index: filter by AI-assigned category
    create_table(
        name="email_messages",
        key_schema=[{"AttributeName": "message_id", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "message_id",  "AttributeType": "S"},
            {"AttributeName": "message_uid", "AttributeType": "N"},
            {"AttributeName": "status",      "AttributeType": "S"},
            {"AttributeName": "category",    "AttributeType": "S"},
        ],
        gsi=[
            {
                "IndexName": "uid-index",
                "KeySchema": [{"AttributeName": "message_uid", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "status-index",
                "KeySchema": [{"AttributeName": "status", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "category-index",
                "KeySchema": [{"AttributeName": "category", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )

    # ── Email Sync State ───────────────────────────────────────────────────────
    # Singleton table — one record with sync_key="email_sync".
    # Stores the last IMAP UID fetched so the worker knows where to resume
    # without re-processing old messages.
    create_table(
        name="email_sync_state",
        key_schema=[{"AttributeName": "sync_key", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "sync_key", "AttributeType": "S"},
        ],
    )

    # ── Product Master ─────────────────────────────────────────────────────────
    # PK: product_id (UUID)
    # Stores canonical product content: title, description, 6 bullet points,
    # 6 image URLs, keywords JSON.
    create_table(
        name="product_master",
        key_schema=[{"AttributeName": "product_id", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "product_id", "AttributeType": "S"},
        ],
    )

    # ── Word Suggestions ───────────────────────────────────────────────────────
    # PK: suggestion_id (UUID)
    # GSI word-type-index: fetch all suggestions of a given word_type
    create_table(
        name="word_suggestions",
        key_schema=[{"AttributeName": "suggestion_id", "KeyType": "HASH"}],
        attribute_defs=[
            {"AttributeName": "suggestion_id", "AttributeType": "S"},
            {"AttributeName": "word_type",     "AttributeType": "S"},
        ],
        gsi=[
            {
                "IndexName": "word-type-index",
                "KeySchema": [{"AttributeName": "word_type", "KeyType": "HASH"}],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )

    print("=" * 60)
    print(f"All tables ready — stage={STAGE}  prefix='{PREFIX}'")
    print("")
    print("Next: deploy backend code and start services.")


if __name__ == "__main__":
    main()
