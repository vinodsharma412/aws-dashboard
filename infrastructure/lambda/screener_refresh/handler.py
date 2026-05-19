"""Lambda function — pre-compute stock screener results.

Triggered by EventBridge every 30 minutes during NSE market hours
(Mon–Fri 03:45–10:00 UTC = 09:15–15:30 IST).

What it does:
    1. Authenticates against the EC2 FastAPI as a service account.
    2. Calls GET /api/v1/stocks/screener on the EC2 instance.
    3. Writes the result to DynamoDB screener_cache so API responses
       to end-users are instant (<5 ms) instead of 70+ seconds.

Stage awareness:
    Function name pattern: ``nse-screener-refresh-{stage}``
    Environment variable ``STAGE`` sets the DynamoDB table prefix:
        dev  → dev_screener_cache
        qc   → qc_screener_cache
        prod → screener_cache

    ``EC2_API_URL`` should point to the stage-specific API endpoint.

Deploy:
    bash infrastructure/lambda/screener_refresh/deploy.sh <stage>
"""

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

REGION      = os.environ.get("AWS_REGION", "ap-south-1")
STAGE       = os.environ.get("STAGE", "prod").lower()
EC2_API_URL = os.environ.get("EC2_API_URL", "").rstrip("/")
SVC_USERNAME = os.environ.get("SVC_USERNAME", "nse-service")
SVC_PASSWORD = os.environ.get("SVC_PASSWORD", "")

# prod tables have no prefix; dev/qc tables use "{stage}_"
_PREFIX = "" if STAGE == "prod" else f"{STAGE}_"
_CACHE_TABLE_NAME = f"{_PREFIX}screener_cache"

_dynamo      = boto3.resource("dynamodb", region_name=REGION)
_cache_table = _dynamo.Table(_CACHE_TABLE_NAME)


def _get_token() -> str:
    """Authenticate with the EC2 FastAPI and return a JWT bearer token.

    Uses form-encoded POST to /api/v1/auth/token (OAuth2PasswordRequestForm).

    Returns:
        JWT access token string.

    Raises:
        RuntimeError: If login fails (wrong credentials, EC2 unreachable, etc.).
    """
    url  = f"{EC2_API_URL}/api/v1/auth/token"
    data = urllib.parse.urlencode({
        "username": SVC_USERNAME,
        "password": SVC_PASSWORD,
    }).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode())
            return body["access_token"]
    except Exception as exc:
        raise RuntimeError(f"Service account login failed: {exc}") from exc


def _call_screener(token: str, min_yield: float = 0.0, max_pe: float = 50.0, min_score: int = 0) -> list:
    """Call the screener endpoint on EC2 and return the stock list.

    Args:
        token:     JWT bearer token from _get_token().
        min_yield: Minimum dividend yield filter (default 0.0 = no filter).
        max_pe:    Maximum P/E ratio filter (default 50.0).
        min_score: Minimum screening score (default 0 = no filter).

    Returns:
        List of stock dicts as returned by the API.

    Raises:
        RuntimeError: If the HTTP call fails or returns a non-200 status.
    """
    url = (
        f"{EC2_API_URL}/api/v1/stocks/screener"
        f"?min_yield={min_yield}&max_pe={max_pe}&min_score={min_score}"
    )
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Screener HTTP {exc.code}: {exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Screener connection failed: {exc.reason}") from exc


def lambda_handler(event: dict, context) -> dict:
    """Authenticate, call screener on EC2, and cache results in DynamoDB.

    Called by EventBridge every 30 minutes during NSE market hours.

    Args:
        event:   EventBridge scheduled event (not used).
        context: Lambda context object (for logging request ID).

    Returns:
        Dict with ``statusCode`` and ``body`` JSON string.
    """
    logger.info(
        "Screener refresh started. stage=%s table=%s request_id=%s",
        STAGE, _CACHE_TABLE_NAME, getattr(context, "aws_request_id", "local"),
    )
    start = time.time()

    try:
        token   = _get_token()
        results = _call_screener(token, min_yield=0.0, max_pe=50.0, min_score=0)
        elapsed = round(time.time() - start, 1)

        _cache_table.put_item(Item={
            "cache_key":       "screener:0.000:50.0",
            "stage":           STAGE,
            "data":            json.dumps(results),
            "computed_at":     time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "count":           len(results),
            "elapsed_seconds": str(elapsed),
        })

        logger.info("Screener refresh complete: %d stocks cached in %.1fs", len(results), elapsed)
        return {
            "statusCode": 200,
            "body": json.dumps({
                "stocks_cached": len(results),
                "elapsed_seconds": elapsed,
                "stage": STAGE,
                "table": _CACHE_TABLE_NAME,
            }),
        }

    except Exception as exc:
        logger.error("Screener refresh failed: %s", exc, exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(exc), "stage": STAGE}),
        }
