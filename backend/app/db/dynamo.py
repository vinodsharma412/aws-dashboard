"""DynamoDB client and stage-aware table accessors.

Replaces ``db/session.py`` (SQLAlchemy) from the original project.
All tables are accessed via the module-level table objects — no sessions,
no connection pools, no transactions (DynamoDB is NoSQL).

Stage isolation
---------------
Each deployment stage (dev / qc / prod) gets its own set of DynamoDB
tables through a configurable prefix controlled by the ``STAGE`` env var:

    prod  →  prefix ""     →  table name  "users"
    qc    →  prefix "qc_"  →  table name  "qc_users"
    dev   →  prefix "dev_" →  table name  "dev_users"

This prevents lower environments from ever touching production data even
when sharing the same AWS account.

Usage::

    from app.db.dynamo import dynamo_users, dynamo_tasks

    user = dynamo_users.get_item(Key={"user_id": uid})["Item"]
"""

import boto3
from app.config import settings

_dynamodb = boto3.resource("dynamodb", region_name=settings.AWS_REGION)

# Stage prefix: "" for prod, "dev_" for dev, "qc_" for qc.
# Controlled by the STAGE env var in app/config.py.
_p = settings.table_prefix


def _table(name: str):
    """Return a DynamoDB Table resource with the current stage prefix applied.

    Args:
        name: Base table name without any prefix (e.g. ``"users"``).

    Returns:
        boto3 DynamoDB Table resource for ``{stage_prefix}{name}``.
    """
    return _dynamodb.Table(f"{_p}{name}")


# ── Table objects — one per DynamoDB table ────────────────────────────────────

dynamo_users = _table("users")
"""Users table. PK: user_id (UUID). GSI: username-index."""

dynamo_transactions = _table("stock_transactions")
"""Stock transactions. PK: txn_id (UUID). GSI: user-transactions-index."""

dynamo_watchlist = _table("stock_watchlist")
"""Watchlist. PK: wl_id (UUID). GSI: user-watchlist-index, user-symbol-index."""

dynamo_jobs = _table("scraping_jobs")
"""Scraping jobs. PK: job_id (UUID). GSI: user-jobs-index."""

dynamo_tasks = _table("scraping_tasks")
"""Scraping tasks. PK: task_id (UUID). GSI: job-tasks-index, status-index."""

dynamo_products = _table("product_data")
"""Scraped product data. PK: task_id (same UUID as the task)."""

dynamo_screener_cache = _table("screener_cache")
"""Screener pre-compute cache. PK: cache_key. Written by Lambda every 30 min."""

dynamo_menus = _table("menus")
"""Navigation menus. PK: menu_id."""

dynamo_menu_access = _table("menu_access")
"""Menu role permissions. PK: access_id. GSI: menu-index, role-index."""

dynamo_email_messages = _table("email_messages")
"""Inbound email messages. PK: message_id."""

dynamo_email_sync_state = _table("email_sync_state")
"""Email IMAP sync cursor. Singleton — sync_key='email_sync'."""

dynamo_product_master = _table("product_master")
"""Canonical product content. PK: product_id."""

dynamo_word_suggestions = _table("word_suggestions")
"""AI word/phrase suggestions. PK: suggestion_id."""
