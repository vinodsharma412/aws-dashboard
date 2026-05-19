"""Pydantic schemas for stock data, portfolio, and watchlist endpoints.

Note: In the AWS version primary keys are UUID strings (not int).
Timestamps are ISO-8601 strings from DynamoDB (not datetime objects).
"""

from typing import Any, List, Optional

from pydantic import BaseModel, field_validator

#: Valid transaction types.
_TXN_TYPES: frozenset[str] = frozenset({"buy", "sell", "dividend"})


# ── Watchlist ──────────────────────────────────────────────────────────────────


class WatchlistIn(BaseModel):
    """Request body for ``POST /stocks/watchlist``."""

    symbol: str
    company_name: Optional[str] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    notes: Optional[str] = None


class WatchlistOut(WatchlistIn):
    """Watchlist item returned by the API."""

    id: str                     # UUID string (DynamoDB PK)
    added_at: Optional[str] = None


# ── Transactions ───────────────────────────────────────────────────────────────


class TransactionIn(BaseModel):
    """Request body for ``POST /stocks/portfolio/transactions``."""

    symbol: str
    company_name: Optional[str] = None
    transaction_type: str       # buy | sell | dividend
    quantity: float
    price: float
    brokerage: float = 0.0
    notes: Optional[str] = None

    @field_validator("transaction_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        """Reject unknown transaction types early.

        Args:
            v: Value supplied in the request body.

        Returns:
            Validated transaction type string.

        Raises:
            ValueError: If *v* is not in ``_TXN_TYPES``.
        """
        if v not in _TXN_TYPES:
            raise ValueError("transaction_type must be buy, sell, or dividend")
        return v


class TransactionOut(TransactionIn):
    """Transaction record returned by the API."""

    id: str                     # UUID string (DynamoDB PK)
    total_amount: float
    created_at: Optional[str] = None


# ── Stock analysis ─────────────────────────────────────────────────────────────


class TechnicalIndicators(BaseModel):
    rsi: Optional[float] = None
    sma_50: Optional[float] = None
    sma_200: Optional[float] = None
    macd: Optional[float] = None
    macd_signal: Optional[float] = None
    bb_upper: Optional[float] = None
    bb_lower: Optional[float] = None
    price_vs_sma50: Optional[str] = None   # above | below
    price_vs_sma200: Optional[str] = None
    volume_avg: Optional[float] = None
    week_52_high: Optional[float] = None
    week_52_low: Optional[float] = None
    week_52_pct: Optional[float] = None    # % from 52-week high


class Recommendation(BaseModel):
    signal: str                            # Strong Buy | Buy | Hold | Sell | Strong Sell
    score: int
    color: str                             # green | orange | red
    reasons: List[str] = []


class StockAnalysis(BaseModel):
    symbol: str
    company_name: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    current_price: Optional[float] = None
    change_pct: Optional[float] = None
    market_cap: Optional[float] = None
    pe_ratio: Optional[float] = None
    pb_ratio: Optional[float] = None
    eps: Optional[float] = None
    dividend_yield: Optional[float] = None
    payout_ratio: Optional[float] = None
    revenue_growth: Optional[float] = None
    earnings_growth: Optional[float] = None
    debt_to_equity: Optional[float] = None
    roe: Optional[float] = None
    technicals: Optional[TechnicalIndicators] = None
    recommendation: Optional[Recommendation] = None
    exchange: Optional[str] = None
    currency: Optional[str] = "INR"


class ChartCandle(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class SentimentResult(BaseModel):
    symbol: str
    score: float                           # -1.0 to +1.0
    label: str                             # Bullish | Bearish | Neutral
    confidence: str                        # Strong | Moderate | Weak
    headlines: List[dict] = []
    error: Optional[str] = None


class ScreenerResult(BaseModel):
    symbol: str
    company_name: Optional[str] = None
    sector: Optional[str] = None
    current_price: Optional[float] = None
    change_pct: Optional[float] = None
    dividend_yield: Optional[float] = None
    pe_ratio: Optional[float] = None
    market_cap: Optional[float] = None
    rsi: Optional[float] = None
    signal: Optional[str] = None           # Buy | Hold | Sell
    score: Optional[int] = None


class PortfolioSummary(BaseModel):
    total_invested: float
    current_value: float
    total_pnl: float
    pnl_pct: float
    holdings: List[dict] = []
    transactions: List[TransactionOut] = []
