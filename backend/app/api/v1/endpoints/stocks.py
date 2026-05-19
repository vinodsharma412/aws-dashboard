"""Stock data, portfolio, watchlist, and screener endpoints.

All routes require an authenticated active user (``get_current_active_user``).
Service calls are delegated to ``stock_service`` and ``sentiment_service``; the
endpoints contain only HTTP-layer logic (validation, 502 promotion).

AWS difference vs. original:
    - Portfolio and watchlist data stored in DynamoDB via ``crud.stock_dynamo``.
    - No SQLAlchemy session dependency on any route.
    - Primary keys are UUID strings, not integers.

Route summary:
    GET  /search                         — ticker/company search
    GET  /basic/{symbol}                 — fast quote (~1 s)
    GET  /market/global                  — global indices snapshot
    GET  /analyse/{symbol}               — full analysis + composite recommendation
    GET  /chart/{symbol}                 — OHLCV candlestick history
    GET  /sentiment/{symbol}             — news sentiment
    GET  /screener                       — dividend + P/E + score screener
    GET  /financials/{symbol}            — full financial statements
    GET  /portfolio                      — holdings + P&L summary
    GET  /portfolio/insights             — per-holding action recommendations
    POST /portfolio/transactions         — record a buy/sell/dividend
    DELETE /portfolio/transactions/{id}  — remove a transaction
    GET  /watchlist                      — list watchlist items
    POST /watchlist                      — add a symbol to watchlist
    DELETE /watchlist/{id}               — remove from watchlist
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.crud import stock_dynamo
from app.dependencies import get_current_active_user
from app.schemas.stock import (
    PortfolioSummary,
    TransactionIn,
    TransactionOut,
    WatchlistIn,
    WatchlistOut,
)
from app.services import sentiment_service, stock_service

router = APIRouter()


# ── Search ─────────────────────────────────────────────────────────────────────


@router.get("/search")
def search(
    q: str = Query(..., min_length=1),
    _: dict = Depends(get_current_active_user),
) -> list:
    """Search the NSE equity universe by symbol or company name.

    Args:
        q: Search string (minimum 1 character).
        _: Auth guard.

    Returns:
        Up to 20 dicts with ``symbol`` and ``company_name``.
    """
    return stock_service.search_stocks(q)


# ── Fast basic quote ───────────────────────────────────────────────────────────


@router.get("/basic/{symbol}")
def basic_quote(
    symbol: str,
    _: dict = Depends(get_current_active_user),
) -> dict:
    """Return a fast price quote using ``yf.Ticker.fast_info`` (~1 s response).

    Args:
        symbol: NSE ticker symbol (case-insensitive).
        _: Auth guard.

    Returns:
        Quote dict with ``current_price``, ``change_pct``, SMA, year range, etc.

    Raises:
        HTTPException 502: If yfinance fails for the symbol.
    """
    data = stock_service.get_basic_quote(symbol.upper())
    if data.get("error"):
        raise HTTPException(status_code=502, detail=data["error"])
    return data


# ── Global market indices ──────────────────────────────────────────────────────


@router.get("/market/global")
def global_markets(_: dict = Depends(get_current_active_user)) -> list:
    """Return a snapshot of global market indices (Nifty, S&P 500, Nikkei, etc.).

    Args:
        _: Auth guard.

    Returns:
        List of index dicts with ``name``, ``price``, ``change_pct``, etc.
    """
    return stock_service.get_global_markets()


# ── Stock analysis ─────────────────────────────────────────────────────────────


@router.get("/analyse/{symbol}")
def analyse(
    symbol: str,
    _: dict = Depends(get_current_active_user),
) -> dict:
    """Run full technical + fundamental analysis for *symbol*.

    Fetches sentiment first and merges the score into the composite
    recommendation before returning.

    Args:
        symbol: NSE ticker symbol (case-insensitive).
        _: Auth guard.

    Returns:
        Analysis dict including ``technicals``, ``recommendation``,
        ``valuation``, ``entry_exit``, and ``sector_schemes``.

    Raises:
        HTTPException 502: If the yfinance data fetch fails.
    """
    sym = symbol.upper()
    sent = sentiment_service.analyze_sentiment(sym)
    data = stock_service.get_stock_analysis(sym, sent.get("score", 0.0))
    if data.get("error"):
        raise HTTPException(status_code=502, detail=data["error"])
    return data


@router.get("/chart/{symbol}")
def chart(
    symbol: str,
    period: str = Query("1y"),
    _: dict = Depends(get_current_active_user),
) -> list:
    """Return OHLCV candlestick data for the requested period.

    Args:
        symbol: NSE ticker symbol (case-insensitive).
        period: History period (``"1d"``, ``"1y"``, ``"2y"``, etc.).
        _: Auth guard.

    Returns:
        List of OHLCV dicts with ``date``, ``open``, ``high``, ``low``,
        ``close``, ``volume``.

    Raises:
        HTTPException 404: If no data is available for the symbol/period.
    """
    rows = stock_service.get_chart_data(symbol.upper(), period)
    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No chart data available for this symbol.",
        )
    return rows


@router.get("/sentiment/{symbol}")
def sentiment(
    symbol: str,
    _: dict = Depends(get_current_active_user),
) -> dict:
    """Return news sentiment analysis for *symbol*.

    Args:
        symbol: NSE ticker symbol (case-insensitive).
        _: Auth guard.

    Returns:
        Sentiment dict with ``score``, ``label``, ``confidence``,
        ``headlines``, and ``macro_news``.
    """
    name = stock_service.NSE_UNIVERSE.get(symbol.upper(), "")
    return sentiment_service.analyze_sentiment(symbol.upper(), name)


# ── Screener ───────────────────────────────────────────────────────────────────


@router.get("/screener")
def screener(
    min_yield: float = Query(0.03, ge=0.0, le=0.20),
    max_pe: float = Query(50.0, ge=0.0),
    min_score: int = Query(0),
    _: dict = Depends(get_current_active_user),
) -> list:
    """Screen NSE stocks by dividend yield, P/E ratio, and composite score.

    Args:
        min_yield: Minimum dividend yield (0.0 = no filter).
        max_pe: Maximum trailing P/E ratio.
        min_score: Minimum composite recommendation score (0 = no filter).
        _: Auth guard.

    Returns:
        Filtered and sorted list of up to 40 stock summary dicts.
    """
    results = stock_service.screen_stocks(min_yield, max_pe, min_score)
    if min_score:
        results = [r for r in results if (r.get("score") or 0) >= min_score]
    return results


# ── Detailed financials ────────────────────────────────────────────────────────


@router.get("/financials/{symbol}")
def financials(
    symbol: str,
    _: dict = Depends(get_current_active_user),
) -> dict:
    """Return full financial statements (P&L, Balance Sheet, Cash Flow, Ratios).

    Args:
        symbol: NSE ticker symbol (case-insensitive).
        _: Auth guard.

    Returns:
        Financial data dict with annual and quarterly breakdowns.

    Raises:
        HTTPException 502: If the yfinance data fetch fails.
    """
    data = stock_service.get_detailed_financials(symbol.upper())
    if data.get("error"):
        raise HTTPException(status_code=502, detail=data["error"])
    return data


# ── Portfolio / Transactions ───────────────────────────────────────────────────


def _txn_to_schema(t: dict) -> TransactionOut:
    """Convert a raw DynamoDB transaction dict to the ``TransactionOut`` schema.

    DynamoDB stores numeric fields as strings (Decimal-safe). This helper
    casts them back to float before Pydantic validation.

    Args:
        t: Raw DynamoDB transaction item.

    Returns:
        Validated ``TransactionOut`` instance.
    """
    return TransactionOut(
        id=t["txn_id"],
        symbol=t["symbol"],
        company_name=t.get("company_name", ""),
        transaction_type=t["transaction_type"],
        quantity=float(t["quantity"]),
        price=float(t["price"]),
        total_amount=float(t["total_amount"]),
        brokerage=float(t.get("brokerage", 0)),
        notes=t.get("notes"),
        created_at=t.get("created_at"),
    )


@router.get("/portfolio", response_model=PortfolioSummary)
def get_portfolio(
    current_user: dict = Depends(get_current_active_user),
) -> PortfolioSummary:
    """Return the user's portfolio holdings, P&L, and transaction history.

    Args:
        current_user: Authenticated user dict.

    Returns:
        ``PortfolioSummary`` with ``total_invested``, ``current_value``,
        ``total_pnl``, ``pnl_pct``, ``holdings``, and ``transactions``.
    """
    raw_txns = stock_dynamo.get_transactions(current_user["user_id"])

    # stock_service.calculate_portfolio expects ORM-like objects; pass dicts
    # with float-cast numeric fields so the calculation logic works unchanged.
    txns_for_calc = [
        type("T", (), {
            "symbol": t["symbol"],
            "transaction_type": t["transaction_type"],
            "quantity": float(t["quantity"]),
            "price": float(t["price"]),
            "total_amount": float(t["total_amount"]),
            "brokerage": float(t.get("brokerage", 0)),
        })()
        for t in raw_txns
    ]

    pnl = stock_service.calculate_portfolio(txns_for_calc)
    return PortfolioSummary(
        total_invested=pnl["total_invested"],
        current_value=pnl["current_value"],
        total_pnl=pnl["total_pnl"],
        pnl_pct=pnl["pnl_pct"],
        holdings=pnl["holdings"],
        transactions=[_txn_to_schema(t) for t in raw_txns],
    )


@router.get("/portfolio/insights")
def portfolio_insights(
    current_user: dict = Depends(get_current_active_user),
) -> list:
    """Return actionable recommendations for each portfolio holding.

    Uses cached technical analysis — no additional yfinance calls.

    Args:
        current_user: Authenticated user dict.

    Returns:
        List of insight dicts sorted by urgency (``"high"`` first).
    """
    raw_txns = stock_dynamo.get_transactions(current_user["user_id"])
    txns_for_calc = [
        type("T", (), {
            "symbol": t["symbol"],
            "transaction_type": t["transaction_type"],
            "quantity": float(t["quantity"]),
            "price": float(t["price"]),
            "total_amount": float(t["total_amount"]),
            "brokerage": float(t.get("brokerage", 0)),
        })()
        for t in raw_txns
    ]
    pnl = stock_service.calculate_portfolio(txns_for_calc)
    return stock_service.generate_portfolio_insights(pnl["holdings"])


@router.post("/portfolio/transactions", response_model=TransactionOut)
def add_transaction(
    payload: TransactionIn,
    current_user: dict = Depends(get_current_active_user),
) -> TransactionOut:
    """Record a new stock transaction (buy, sell, or dividend) in DynamoDB.

    ``total_amount`` is computed as ``quantity × price ± brokerage``.
    Sell transactions store a negative quantity so ``calculate_portfolio``
    can reverse the cost basis correctly.

    Args:
        payload: Validated ``TransactionIn`` schema.
        current_user: Authenticated user dict.

    Returns:
        The newly created transaction serialised as ``TransactionOut``.
    """
    sign = -1 if payload.transaction_type == "sell" else 1
    total_amount = abs(sign * payload.quantity * payload.price + payload.brokerage)

    txn = stock_dynamo.create_transaction(
        user_id=current_user["user_id"],
        symbol=payload.symbol.upper(),
        company_name=(
            payload.company_name
            or stock_service.NSE_UNIVERSE.get(payload.symbol.upper(), "")
        ),
        transaction_type=payload.transaction_type,
        quantity=payload.quantity,
        price=payload.price,
        total_amount=total_amount,
        brokerage=payload.brokerage,
        notes=payload.notes,
    )
    return _txn_to_schema(txn)


@router.delete("/portfolio/transactions/{txn_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    txn_id: str,
    current_user: dict = Depends(get_current_active_user),
) -> None:
    """Permanently delete a transaction record from DynamoDB.

    Args:
        txn_id: UUID string primary key of the transaction.
        current_user: Authenticated user dict (ownership is enforced).

    Raises:
        HTTPException 404: If no transaction exists with *txn_id*.
        HTTPException 403: If the transaction belongs to a different user.
    """
    txn = stock_dynamo.get_transaction(txn_id)
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    if txn.get("user_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Access denied.")
    stock_dynamo.delete_transaction(txn_id)


# ── Watchlist ──────────────────────────────────────────────────────────────────


def _wl_to_schema(w: dict) -> WatchlistOut:
    """Convert a raw DynamoDB watchlist item to the ``WatchlistOut`` schema.

    Args:
        w: Raw DynamoDB watchlist item.

    Returns:
        Validated ``WatchlistOut`` instance.
    """
    return WatchlistOut(
        id=w["wl_id"],
        symbol=w["symbol"],
        company_name=w.get("company_name"),
        target_price=float(w["target_price"]) if w.get("target_price") else None,
        stop_loss=float(w["stop_loss"]) if w.get("stop_loss") else None,
        notes=w.get("notes"),
        added_at=w.get("added_at"),
    )


@router.get("/watchlist", response_model=List[WatchlistOut])
def list_watchlist(
    current_user: dict = Depends(get_current_active_user),
) -> list:
    """Return all watchlist entries for the current user.

    Args:
        current_user: Authenticated user dict.

    Returns:
        List of watchlist items ordered newest first.
    """
    items = stock_dynamo.get_watchlist(current_user["user_id"])
    return [_wl_to_schema(w) for w in items]


@router.post("/watchlist", response_model=WatchlistOut)
def add_watchlist(
    payload: WatchlistIn,
    current_user: dict = Depends(get_current_active_user),
) -> WatchlistOut:
    """Add a symbol to the user's watchlist in DynamoDB.

    Args:
        payload: ``WatchlistIn`` with symbol and optional price targets.
        current_user: Authenticated user dict.

    Returns:
        The newly created watchlist item serialised as ``WatchlistOut``.

    Raises:
        HTTPException 409: If the symbol is already in the user's watchlist.
    """
    sym = payload.symbol.upper()
    existing = stock_dynamo.find_by_symbol(current_user["user_id"], sym)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{sym} is already in your watchlist.",
        )

    item = stock_dynamo.add_to_watchlist(
        user_id=current_user["user_id"],
        symbol=sym,
        company_name=(
            payload.company_name or stock_service.NSE_UNIVERSE.get(sym, "")
        ),
        target_price=payload.target_price,
        stop_loss=payload.stop_loss,
        notes=payload.notes,
    )
    return _wl_to_schema(item)


@router.delete("/watchlist/{wl_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_watchlist(
    wl_id: str,
    current_user: dict = Depends(get_current_active_user),
) -> None:
    """Remove an item from the user's watchlist.

    Args:
        wl_id: UUID string primary key of the watchlist item.
        current_user: Authenticated user dict (ownership is enforced).

    Raises:
        HTTPException 404: If no item exists with *wl_id*.
        HTTPException 403: If the item belongs to a different user.
    """
    item = stock_dynamo.get_watchlist_item(wl_id)
    if not item:
        raise HTTPException(status_code=404, detail="Watchlist item not found.")
    if item.get("user_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Access denied.")
    stock_dynamo.remove_from_watchlist(wl_id)
