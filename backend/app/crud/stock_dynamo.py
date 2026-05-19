"""Portfolio transaction and watchlist CRUD operations against DynamoDB.

Replaces the SQLAlchemy ``StockTransaction`` / ``StockWatchlist`` ORM queries
from the original project.  All items are plain dicts; PKs are UUID strings.

DynamoDB access patterns:
    Transactions:
        get_transactions      →  Query user-transactions-index GSI
        create_transaction    →  PutItem on nse_stock_transactions
        delete_transaction    →  DeleteItem (txn_id PK)
        get_transaction       →  GetItem (txn_id PK)

    Watchlist:
        get_watchlist         →  Query user-watchlist-index GSI
        add_to_watchlist      →  PutItem on nse_stock_watchlist
        remove_from_watchlist →  DeleteItem (wl_id PK)
        get_watchlist_item    →  GetItem (wl_id PK)
        find_by_symbol        →  Query user-symbol-index GSI
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from boto3.dynamodb.conditions import Key

from app.db.dynamo import dynamo_transactions, dynamo_watchlist


# ── Transactions ───────────────────────────────────────────────────────────────


def get_transactions(user_id: str) -> list[dict]:
    """Return all transactions for *user_id*, newest first.

    Args:
        user_id: UUID string of the owning user.

    Returns:
        List of transaction dicts ordered by ``created_at`` descending.
    """
    resp = dynamo_transactions.query(
        IndexName="user-transactions-index",
        KeyConditionExpression=Key("user_id").eq(user_id),
    )
    items = resp.get("Items", [])
    return sorted(items, key=lambda t: t.get("created_at", ""), reverse=True)


def get_transaction(txn_id: str) -> Optional[dict]:
    """Fetch a transaction by primary key.

    Args:
        txn_id: UUID string primary key.

    Returns:
        Transaction dict or ``None``.
    """
    resp = dynamo_transactions.get_item(Key={"txn_id": txn_id})
    return resp.get("Item")


def create_transaction(
    user_id: str,
    symbol: str,
    company_name: str,
    transaction_type: str,
    quantity: float,
    price: float,
    total_amount: float,
    brokerage: float = 0.0,
    notes: Optional[str] = None,
) -> dict:
    """Record a new stock transaction in DynamoDB.

    Args:
        user_id: UUID string of the owning user.
        symbol: NSE ticker symbol (already upper-cased by the endpoint).
        company_name: Full company name for display.
        transaction_type: One of ``"buy"``, ``"sell"``, ``"dividend"``.
        quantity: Number of shares.
        price: Price per share.
        total_amount: ``quantity × price ± brokerage`` (pre-computed by endpoint).
        brokerage: Brokerage/commission paid.
        notes: Optional free-text note.

    Returns:
        The newly created transaction dict.
    """
    txn = {
        "txn_id": str(uuid.uuid4()),
        "user_id": user_id,
        "symbol": symbol,
        "company_name": company_name,
        "transaction_type": transaction_type,
        "quantity": str(quantity),      # DynamoDB stores Decimal as string-float
        "price": str(price),
        "total_amount": str(total_amount),
        "brokerage": str(brokerage),
        "notes": notes or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    dynamo_transactions.put_item(Item=txn)
    return txn


def delete_transaction(txn_id: str) -> None:
    """Permanently delete a transaction record.

    Args:
        txn_id: UUID string primary key.
    """
    dynamo_transactions.delete_item(Key={"txn_id": txn_id})


# ── Watchlist ──────────────────────────────────────────────────────────────────


def get_watchlist(user_id: str) -> list[dict]:
    """Return all watchlist entries for *user_id*, newest first.

    Args:
        user_id: UUID string of the owning user.

    Returns:
        List of watchlist item dicts ordered by ``added_at`` descending.
    """
    resp = dynamo_watchlist.query(
        IndexName="user-watchlist-index",
        KeyConditionExpression=Key("user_id").eq(user_id),
    )
    items = resp.get("Items", [])
    return sorted(items, key=lambda w: w.get("added_at", ""), reverse=True)


def get_watchlist_item(wl_id: str) -> Optional[dict]:
    """Fetch a watchlist item by primary key.

    Args:
        wl_id: UUID string primary key.

    Returns:
        Watchlist item dict or ``None``.
    """
    resp = dynamo_watchlist.get_item(Key={"wl_id": wl_id})
    return resp.get("Item")


def find_by_symbol(user_id: str, symbol: str) -> Optional[dict]:
    """Check if a symbol is already in the user's watchlist.

    Uses the ``user-symbol-index`` GSI (partition: user_id, sort: symbol).

    Args:
        user_id: UUID string of the user.
        symbol: Ticker symbol (upper-cased).

    Returns:
        Existing watchlist item dict or ``None``.
    """
    resp = dynamo_watchlist.query(
        IndexName="user-symbol-index",
        KeyConditionExpression=(
            Key("user_id").eq(user_id) & Key("symbol").eq(symbol)
        ),
        Limit=1,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def add_to_watchlist(
    user_id: str,
    symbol: str,
    company_name: str,
    target_price: Optional[float] = None,
    stop_loss: Optional[float] = None,
    notes: Optional[str] = None,
) -> dict:
    """Add a symbol to the user's watchlist in DynamoDB.

    Args:
        user_id: UUID string of the owning user.
        symbol: NSE ticker symbol (already upper-cased).
        company_name: Full company name for display.
        target_price: Optional target sell price.
        stop_loss: Optional stop-loss price.
        notes: Optional free-text note.

    Returns:
        The newly created watchlist item dict.
    """
    item = {
        "wl_id": str(uuid.uuid4()),
        "user_id": user_id,
        "symbol": symbol,
        "company_name": company_name,
        "target_price": str(target_price) if target_price is not None else None,
        "stop_loss": str(stop_loss) if stop_loss is not None else None,
        "notes": notes or "",
        "added_at": datetime.now(timezone.utc).isoformat(),
    }
    dynamo_watchlist.put_item(Item=item)
    return item


def remove_from_watchlist(wl_id: str) -> None:
    """Remove a watchlist item by primary key.

    Args:
        wl_id: UUID string primary key.
    """
    dynamo_watchlist.delete_item(Key={"wl_id": wl_id})
