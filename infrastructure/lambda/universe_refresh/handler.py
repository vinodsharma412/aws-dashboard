"""Lambda function — daily NSE universe refresh.

Triggered by EventBridge at 3 AM IST (21:30 UTC) every day.
Downloads ``EQUITY_L.csv`` from NSE (the complete list of equity-segment symbols)
and stores it as a single JSON record in DynamoDB ``{prefix}product_data``.

Stage awareness:
    The Lambda function name follows the pattern ``nse-universe-refresh-{stage}``.
    The environment variable ``STAGE`` (set via Lambda env) controls which
    DynamoDB table prefix is used:
        dev  → dev_product_data
        qc   → qc_product_data
        prod → product_data

Why Lambda (not EC2)?
    This job takes < 10 seconds and only needs one HTTP download — no browser,
    no Playwright, no heavy dependencies. Lambda cold-starts in ~1 s on Python 3.12
    with the tiny urllib3 + boto3 package set already bundled in the runtime.

Deploy:
    bash infrastructure/lambda/universe_refresh/deploy.sh <stage>
"""

import json
import logging
import os
import time
import urllib.request

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION = os.environ.get("AWS_REGION", "ap-south-1")
STAGE  = os.environ.get("STAGE", "prod").lower()

# prod uses no prefix; dev/qc use "{stage}_"
_PREFIX = "" if STAGE == "prod" else f"{STAGE}_"
TABLE_NAME = f"{_PREFIX}product_data"

_NSE_EQUITY_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"

_dynamo = boto3.resource("dynamodb", region_name=REGION)
_table  = _dynamo.Table(TABLE_NAME)


def _download_csv(url: str) -> list[dict]:
    """Download NSE EQUITY_L.csv and parse into a list of symbol dicts.

    Args:
        url: HTTPS URL of the CSV file on NSE's archive server.

    Returns:
        List of dicts with keys ``symbol``, ``name``, ``series``.
    """
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8", errors="replace")

    lines = raw.strip().splitlines()
    if len(lines) < 2:
        return []

    # Header line: SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,...
    headers = [h.strip().lower().replace(" ", "_") for h in lines[0].split(",")]
    rows = []
    for line in lines[1:]:
        parts = line.split(",")
        if len(parts) < 3:
            continue
        row = dict(zip(headers, parts))
        rows.append({
            "symbol": row.get("symbol", "").strip(),
            "name":   row.get("name_of_company", "").strip(),
            "series": row.get("series", "").strip(),
        })
    return rows


def lambda_handler(event: dict, context) -> dict:
    """Download NSE equity universe and store the symbol list in DynamoDB.

    Called by EventBridge on a daily schedule (3 AM IST).
    The result is stored as a single item with ``task_id="nse_universe"``.
    The screener and stock-search endpoints read from this item to resolve
    symbol names without hitting an external API on every request.

    Args:
        event:   EventBridge scheduled event payload (not used).
        context: Lambda context object (for logging request ID).

    Returns:
        Dict with ``statusCode``, ``symbols_stored``, and ``elapsed_seconds``.
    """
    logger.info(
        "Universe refresh started. stage=%s table=%s request_id=%s",
        STAGE, TABLE_NAME, getattr(context, "aws_request_id", "local"),
    )
    start = time.time()

    try:
        symbols = _download_csv(_NSE_EQUITY_URL)
        if not symbols:
            raise ValueError("No symbols parsed from EQUITY_L.csv — file may be empty or format changed")

        _table.put_item(Item={
            "task_id":      "nse_universe",
            "stage":        STAGE,
            "symbols":      json.dumps(symbols),     # full list as JSON string
            "count":        len(symbols),
            "refreshed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })

        elapsed = round(time.time() - start, 1)
        logger.info("Universe refresh complete: %d symbols in %.1fs", len(symbols), elapsed)

        return {
            "statusCode": 200,
            "body": json.dumps({
                "symbols_stored": len(symbols),
                "elapsed_seconds": elapsed,
                "stage": STAGE,
                "table": TABLE_NAME,
            }),
        }

    except Exception as exc:
        logger.error("Universe refresh failed: %s", exc, exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(exc), "stage": STAGE}),
        }
