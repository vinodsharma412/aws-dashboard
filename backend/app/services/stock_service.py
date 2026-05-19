"""
NSE Stock Service — yfinance integration, technical analysis, and recommendation engine.

Uses curl_cffi browser impersonation to avoid Yahoo Finance rate limits (429).
A single shared Session is reused across all requests for connection pooling.
"""
import io
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import yfinance as yf
import pandas as pd

try:
    from curl_cffi import requests as cffi_requests
    _SESSION = cffi_requests.Session(impersonate="chrome110")
    logger_tmp = logging.getLogger(__name__)
    logger_tmp.info("curl_cffi session initialised (chrome110 impersonation)")
except ImportError:
    _SESSION = None   # fall back to standard requests

logger = logging.getLogger(__name__)


def _ticker(symbol: str) -> yf.Ticker:
    """Return a ``yf.Ticker`` bound to the shared curl_cffi session.

    The curl_cffi session impersonates a real Chrome browser at the TLS
    handshake level, which avoids Yahoo Finance's 429 rate-limit responses
    triggered by plain Python ``requests``.  Falls back to the default session
    when curl_cffi is not installed.

    Args:
        symbol: Yahoo Finance ticker symbol (e.g. ``"TCS.NS"``).

    Returns:
        A ``yfinance.Ticker`` object ready to call ``.info``, ``.history``, etc.
    """
    return yf.Ticker(symbol, session=_SESSION) if _SESSION else yf.Ticker(symbol)


# ── Rate-limit-aware fetcher ──────────────────────────────────────────────────

def _yf_info(symbol: str, retries: int = 3) -> dict:
    """Fetch ``yf.Ticker.info`` with retry and exponential back-off.

    Yahoo Finance rate-limits aggressive callers with HTTP 429.  This helper
    retries up to *retries* times with delays of 3 s, 6 s, and 12 s.

    Args:
        symbol: Yahoo Finance ticker symbol.
        retries: Maximum number of attempts before giving up.

    Returns:
        The ``info`` dict on success, or ``{}`` on permanent failure (so
        callers can safely use ``.get()`` without crashing).
    """
    for attempt in range(retries):
        try:
            ticker = _ticker(symbol)
            info   = ticker.info or {}
            if info and len(info) > 3:
                return info
            time.sleep(1.5 * (attempt + 1))
        except Exception as exc:
            msg = str(exc)
            is_retriable = any(k in msg for k in ("429", "Too Many Requests", "Expecting value"))
            if is_retriable and attempt < retries - 1:
                delay = 3.0 * (2 ** attempt)   # 3 s, 6 s, 12 s
                logger.warning("Rate-limited for %s — sleeping %.0fs (attempt %d/%d)",
                               symbol, delay, attempt + 1, retries)
                time.sleep(delay)
                continue
            logger.warning("yf_info failed for %s: %s", symbol, exc)
            return {}
    return {}


def _yf_history(symbol: str, period: str, retries: int = 3) -> pd.DataFrame:
    """Fetch historical OHLCV data with retry on rate-limit or empty response.

    Args:
        symbol: Yahoo Finance ticker symbol.
        period: History period string accepted by yfinance
            (``"1d"``, ``"1y"``, ``"2y"``, etc.).
        retries: Maximum number of attempts before giving up.

    Returns:
        A ``pandas.DataFrame`` with OHLCV columns indexed by date, or an empty
        ``DataFrame`` on permanent failure.
    """
    for attempt in range(retries):
        try:
            hist = _ticker(symbol).history(period=period)
            if not hist.empty:
                return hist
            time.sleep(1.0 * (attempt + 1))
        except Exception as exc:
            msg = str(exc)
            if any(k in msg for k in ("429", "Too Many Requests", "Expecting value")) \
                    and attempt < retries - 1:
                delay = 2.0 * (2 ** attempt)
                logger.warning("History rate-limited for %s — sleeping %.0fs", symbol, delay)
                time.sleep(delay)
                continue
            logger.warning("yf_history failed for %s: %s", symbol, exc)
            return pd.DataFrame()
    return pd.DataFrame()

# ── NSE universe (symbol → company name) ─────────────────────────────────────
NSE_UNIVERSE = {
    # IT & Tech
    "TCS.NS":       "Tata Consultancy Services",
    "INFY.NS":      "Infosys",
    "WIPRO.NS":     "Wipro",
    "HCLTECH.NS":   "HCL Technologies",
    "TECHM.NS":     "Tech Mahindra",
    "LTIM.NS":      "LTIMindtree",
    "MPHASIS.NS":   "Mphasis",
    "PERSISTENT.NS":"Persistent Systems",
    # Banking & Finance
    "HDFCBANK.NS":  "HDFC Bank",
    "ICICIBANK.NS": "ICICI Bank",
    "SBIN.NS":      "State Bank of India",
    "AXISBANK.NS":  "Axis Bank",
    "KOTAKBANK.NS": "Kotak Mahindra Bank",
    "BANKBARODA.NS":"Bank of Baroda",
    "PNB.NS":       "Punjab National Bank",
    "CANBK.NS":     "Canara Bank",
    "IDFCFIRSTB.NS":"IDFC First Bank",
    "BAJFINANCE.NS":"Bajaj Finance",
    "BAJAJFINSV.NS":"Bajaj Finserv",
    "HDFCLIFE.NS":  "HDFC Life Insurance",
    "SBILIFE.NS":   "SBI Life Insurance",
    "ICICIPRULI.NS":"ICICI Prudential Life",
    "MUTHOOTFIN.NS":"Muthoot Finance",
    "CHOLAFIN.NS":  "Cholamandalam Investment",
    # FMCG
    "HINDUNILVR.NS":"Hindustan Unilever",
    "ITC.NS":       "ITC",
    "NESTLEIND.NS": "Nestle India",
    "MARICO.NS":    "Marico",
    "DABUR.NS":     "Dabur India",
    "GODREJCP.NS":  "Godrej Consumer Products",
    "COLPAL.NS":    "Colgate-Palmolive India",
    "BRITANNIA.NS": "Britannia Industries",
    "TATACONSUM.NS":"Tata Consumer Products",
    # Pharma & Healthcare
    "SUNPHARMA.NS": "Sun Pharmaceutical",
    "DRREDDY.NS":   "Dr Reddy's Laboratories",
    "CIPLA.NS":     "Cipla",
    "DIVISLAB.NS":  "Divi's Laboratories",
    "APOLLOHOSP.NS":"Apollo Hospitals",
    "MAXHEALTH.NS": "Max Healthcare",
    "LUPIN.NS":     "Lupin",
    "BIOCON.NS":    "Biocon",
    # Energy & Power
    "RELIANCE.NS":  "Reliance Industries",
    "ONGC.NS":      "ONGC",
    "NTPC.NS":      "NTPC",
    "POWERGRID.NS": "Power Grid Corporation",
    "COALINDIA.NS": "Coal India",
    "BPCL.NS":      "Bharat Petroleum",
    "IOC.NS":       "Indian Oil Corporation",
    "TATAPOWER.NS": "Tata Power",
    "ADANIGREEN.NS":"Adani Green Energy",
    "ADANIPORTS.NS":"Adani Ports",
    # Auto
    "TATAMOTORS.NS":"Tata Motors",
    "MARUTI.NS":    "Maruti Suzuki",
    "BAJAJ-AUTO.NS":"Bajaj Auto",
    "HEROMOTOCO.NS":"Hero MotoCorp",
    "EICHERMOT.NS": "Eicher Motors",
    "ASHOKLEY.NS":  "Ashok Leyland",
    "TVSMOTORS.NS": "TVS Motor Company",
    # Metals & Mining
    "TATASTEEL.NS": "Tata Steel",
    "JSWSTEEL.NS":  "JSW Steel",
    "HINDALCO.NS":  "Hindalco Industries",
    "VEDL.NS":      "Vedanta",
    "SAIL.NS":      "Steel Authority of India",
    "NMDC.NS":      "NMDC",
    # Cement
    "ULTRACEMCO.NS":"UltraTech Cement",
    "SHREECEM.NS":  "Shree Cement",
    "ACC.NS":       "ACC",
    "AMBUJACEMENT.NS":"Ambuja Cements",
    # Telecom
    "BHARTIARTL.NS":"Bharti Airtel",
    "INDUSTOWER.NS":"Indus Towers",
    # Infrastructure & Capital Goods
    "LT.NS":        "Larsen & Toubro",
    "LTTS.NS":      "L&T Technology Services",
    "BEL.NS":       "Bharat Electronics",
    "HAL.NS":       "Hindustan Aeronautics",
    "SIEMENS.NS":   "Siemens India",
    # Consumer Durables & Retail
    "TITAN.NS":     "Titan Company",
    "ASIANPAINT.NS":"Asian Paints",
    "PIDILITIND.NS":"Pidilite Industries",
    "HAVELLS.NS":   "Havells India",
    "VOLTAS.NS":    "Voltas",
    "TRENT.NS":     "Trent",
    # Chemicals
    "SRF.NS":       "SRF",
    "DEEPAKNTR.NS": "Deepak Nitrite",
    "NAVINFLUOR.NS":"Navin Fluorine",
    # Real Estate
    "DLF.NS":       "DLF",
    "PRESTIGE.NS":  "Prestige Estates",
    "OBEROIRLTY.NS":"Oberoi Realty",
    # Diversified
    "M&M.NS":       "Mahindra & Mahindra",
    "TATACHEM.NS":  "Tata Chemicals",
}

# ── In-memory cache ───────────────────────────────────────────────────────────
_cache: dict = {}
_CACHE_TTL_ANALYSIS    = 1800  # 30 min — avoid hammering Yahoo Finance
_CACHE_TTL_CHART       = 600   # 10 min
_CACHE_TTL_SCREENER    = 3600  # 60 min — screener results are expensive
_CACHE_TTL_FINANCIALS  = 3600  # 60 min — statements don't change intraday
_CACHE_TTL_BASIC_QUOTE = 60    #  1 min — fast_info quote shown immediately on selection
_CACHE_TTL_GLOBAL      = 300   #  5 min — world indices need freshness

# Keys that represent per-share values (must NOT be divided by the currency divisor)
_PER_SHARE_ROWS: frozenset[str] = frozenset({"Basic EPS", "Diluted EPS"})
# Keys that are unit-less counts (shares outstanding, etc.) — also not divided
_COUNT_ROWS: frozenset[str] = frozenset({"Ordinary Shares Number"})


# ── Full NSE equity universe (fetched from NSE archives CSV) ──────────────────
_NSE_CSV_URL = "https://archives.nseindia.com/content/equities/EQUITY_L.csv"
_NSE_CSV_TTL = 86400          # 24 hours
_NSE_UNI_KEY = "__nse_equity_list__"


def _fetch_nse_universe() -> dict:
    """Download NSE EQUITY_L.csv → {SYMBOL.NS: company_name}. Cached 24 h."""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
            "Referer":    "https://www.nseindia.com",
            "Accept":     "text/html,application/xhtml+xml,*/*",
        }
        if _SESSION:
            resp = _SESSION.get(_NSE_CSV_URL, headers=headers, timeout=15)
            text = resp.text
        else:
            import requests
            resp = requests.get(_NSE_CSV_URL, headers=headers, timeout=15)
            text = resp.text
        df = pd.read_csv(io.StringIO(text))
        universe: dict = {}
        for _, row in df.iterrows():
            sym    = str(row.get("SYMBOL", "")).strip()
            name   = str(row.get("NAME OF COMPANY", "")).strip()
            series = str(row.get("SERIES", "EQ")).strip()
            if series == "EQ" and sym and name and sym != "nan":
                universe[f"{sym}.NS"] = name
        if universe:
            _cache[_NSE_UNI_KEY] = {"ts": time.time(), "data": universe}
            logger.info("NSE universe refreshed: %d EQ stocks", len(universe))
            return universe
    except Exception as exc:
        logger.warning("NSE universe fetch failed: %s — using built-in list", exc)
    return NSE_UNIVERSE


def _get_nse_universe() -> dict:
    """Return the NSE equity universe from cache, refreshing if stale.

    Returns:
        Dict mapping ``"SYMBOL.NS"`` → company name.  Falls back to the
        built-in ``NSE_UNIVERSE`` constant when the download fails.
    """
    entry = _cache.get(_NSE_UNI_KEY)
    if entry and time.time() - entry["ts"] < _NSE_CSV_TTL:
        return entry["data"]
    return _fetch_nse_universe()


def _prefetch_universe() -> None:
    t = threading.Thread(
        target=_fetch_nse_universe, daemon=True, name="nse-universe-prefetch"
    )
    t.start()


_prefetch_universe()


def _cached(key: str, fn, ttl: int = _CACHE_TTL_ANALYSIS):
    """Return a cached result, or call *fn* and store its return value.

    Single-process TTL cache backed by the module-level ``_cache`` dict.
    Not thread-safe for writes, but acceptable for read-heavy workloads where
    occasional double-computation on cache miss is harmless.

    Args:
        key: Cache key string (e.g. ``"analysis:TCS.NS"``).
        fn: Zero-argument callable that produces the value to cache.
        ttl: Time-to-live in seconds.  Defaults to ``_CACHE_TTL_ANALYSIS``.

    Returns:
        The cached value if fresh, otherwise the fresh result of ``fn()``.
    """
    entry = _cache.get(key)
    if entry and time.time() - entry['ts'] < ttl:
        return entry['data']
    result = fn()
    _cache[key] = {'ts': time.time(), 'data': result}
    return result


def _safe_float(val, default=None):
    """Convert *val* to ``float``, returning *default* on failure or NaN.

    Args:
        val: Any value that may be coercible to float (int, str, None, NaN).
        default: Value returned when conversion fails or the result is NaN.

    Returns:
        The float value, or *default*.
    """
    try:
        f = float(val)
        return f if not (f != f) else default  # NaN guard: NaN != NaN is True
    except (TypeError, ValueError):
        return default


def _normalise_yield(val):
    """
    yfinance changed dividend yield format across versions:
      old: 0.0267  (decimal fraction)
      new: 5.18    (looks like a %, but isn't — it's actually forward yield × some multiplier)
    Use trailingAnnualDividendYield (always decimal) when available.
    If the raw value is > 1, it's a non-decimal form; divide by 100 to normalise.
    """
    v = _safe_float(val)
    if v is None:
        return None
    return v / 100.0 if v > 1.0 else v


# ── Graham / Lynch / DCF valuation metrics ────────────────────────────────────

def _calc_valuation_metrics(info: dict) -> dict:
    """
    Advanced valuation analysis.
    Sources: Security Analysis (Graham & Dodd), The Intelligent Investor (Graham),
             One Up On Wall Street (Lynch), Damodaran valuation frameworks.
    """
    eps    = _safe_float(info.get('trailingEps'))
    bvps   = _safe_float(info.get('bookValue'))
    cur    = _safe_float(info.get('currentPrice') or info.get('regularMarketPrice'))
    pe     = _safe_float(info.get('trailingPE'))
    eg     = _safe_float(info.get('earningsGrowth'))
    mc     = _safe_float(info.get('marketCap'))
    fcf    = _safe_float(info.get('freeCashflow'))
    ev     = _safe_float(info.get('enterpriseValue'))
    ebitda = _safe_float(info.get('ebitda'))
    rev    = _safe_float(info.get('totalRevenue'))
    cr     = _safe_float(info.get('currentRatio'))
    roa    = _safe_float(info.get('returnOnAssets'))

    # Graham Number — √(22.5 × EPS × BVPS)
    graham = None
    if eps and eps > 0 and bvps and bvps > 0:
        graham = round((22.5 * eps * bvps) ** 0.5, 2)

    # Margin of Safety (Graham Number vs market price)
    mos = round((graham - cur) / graham * 100, 1) if (graham and cur) else None

    # PEG Ratio — Peter Lynch: PEG < 1 is cheap relative to growth
    peg = round(pe / (eg * 100), 2) if (pe and eg and eg > 0) else None

    # EV/EBITDA — enterprise value multiple (< 12 is reasonable)
    ev_ebitda = round(ev / ebitda, 1) if (ev and ebitda and ebitda > 0) else None

    # FCF Yield (%) — Warren Buffett favors > 5%
    fcf_yield = round(fcf / mc * 100, 2) if (fcf and mc and mc > 0) else None

    # Price/Sales (< 2 is value, > 10 is growth premium)
    ps = round(mc / rev, 2) if (mc and rev and rev > 0) else None

    # Verdict vs Graham Number
    verdict, verdict_color = "N/A", "gray"
    if graham and cur:
        if cur < graham * 0.70:
            verdict, verdict_color = "Deeply Undervalued", "green"
        elif cur < graham * 0.92:
            verdict, verdict_color = "Undervalued", "green"
        elif cur < graham * 1.10:
            verdict, verdict_color = "Fairly Valued", "blue"
        elif cur < graham * 1.35:
            verdict, verdict_color = "Slightly Overvalued", "orange"
        else:
            verdict, verdict_color = "Overvalued", "red"

    return {
        "graham_number":         graham,
        "margin_of_safety":      mos,
        "verdict":               verdict,
        "verdict_color":         verdict_color,
        "peg_ratio":             peg,
        "ev_ebitda":             ev_ebitda,
        "fcf_yield":             fcf_yield,
        "price_to_sales":        ps,
        "book_value_per_share":  bvps,
        "current_ratio":         cr,
        "return_on_assets":      roa,
        "source_note": (
            "Graham Number = √(22.5 × EPS × Book Value) — Benjamin Graham, Security Analysis. "
            "PEG < 1 = value (Peter Lynch). FCF Yield > 5% = strong cash generation."
        ),
    }


# ── Government schemes impact matrix ─────────────────────────────────────────

_SECTOR_SCHEMES: dict = {
    "Technology": [
        {"name": "PLI — IT Hardware",       "type": "positive",
         "desc": "₹17,000 Cr PLI for electronics/IT hardware boosts domestic manufacturing and services demand."},
        {"name": "Digital India Mission",    "type": "positive",
         "desc": "Massive govt IT spend benefits Indian IT firms via public-sector contracts and digital infra projects."},
        {"name": "BharatNet Phase III",      "type": "positive",
         "desc": "Optical fiber to 6.4L villages — expands digital services market and drives rural internet economy."},
    ],
    "Financial Services": [
        {"name": "UPI / NPCI Expansion",    "type": "positive",
         "desc": "Digital payments volume growing 40%+ YoY. Drives fintech and banking fee income growth."},
        {"name": "RBI Repo Rate (6.5%)",    "type": "mixed",
         "desc": "Elevated rates compress floating-rate NIMs. Watch for RBI rate-cut cycle as inflation normalises."},
        {"name": "Account Aggregator (AA)", "type": "positive",
         "desc": "Open banking framework enables data-driven credit — major opportunity for NBFCs and fintechs."},
        {"name": "CGTMSE MSME Credit",      "type": "positive",
         "desc": "Credit guarantee expansion increases SME lending — benefits PSU and private sector banks."},
    ],
    "Consumer Discretionary": [
        {"name": "FAME III — EV Subsidies", "type": "positive",
         "desc": "EV adoption subsidies benefit Tata Motors, Ola Electric, TVS, Bajaj. Key sector catalyst."},
        {"name": "PLI — Auto & EV",         "type": "positive",
         "desc": "₹25,938 Cr PLI drives auto sector capex. Boost for OEMs and auto ancillaries."},
        {"name": "PM-KISAN + MNREGA",       "type": "positive",
         "desc": "Rural income transfers boost 2-wheeler and FMCG demand in Bharat markets."},
    ],
    "Consumer Staples": [
        {"name": "PMGKAY Free Food Grain",  "type": "mixed",
         "desc": "Free grain for 80Cr people reduces some branded staples volume at bottom of pyramid."},
        {"name": "Edible Oil Mission",      "type": "mixed",
         "desc": "Domestic oilseed push may affect import volumes and pricing dynamics for FMCG players."},
    ],
    "Industrials": [
        {"name": "PM Gati Shakti",          "type": "positive",
         "desc": "₹100+ lakh Cr infra master plan. L&T, BEL, HAL, Siemens India are direct beneficiaries."},
        {"name": "Defence Indigenisation",  "type": "positive",
         "desc": "75% of defence capex reserved for domestic. HAL, BEL, Data Patterns benefit strongly."},
        {"name": "PLI — White Goods",       "type": "positive",
         "desc": "Manufacturing incentives drive consumer durables capex and domestic production."},
    ],
    "Energy": [
        {"name": "Green Hydrogen Mission",  "type": "positive",
         "desc": "₹19,744 Cr for green hydrogen — NTPC, ONGC, Adani Green positioned as key players."},
        {"name": "PM Surya Ghar Solar",     "type": "positive",
         "desc": "1 Cr rooftop solar installations targeted — massive demand driver for solar sector."},
        {"name": "OMC Fuel Price Regulation","type": "mixed",
         "desc": "Govt-controlled petrol/diesel prices limit IOC, BPCL, HPCL margin predictability."},
        {"name": "RDSS — Power Distribution","type": "positive",
         "desc": "₹3 lakh Cr power distribution reform reduces AT&C losses, improves DISCOM finances."},
    ],
    "Basic Materials": [
        {"name": "PLI — Specialty Steel",   "type": "positive",
         "desc": "₹6,322 Cr incentive for high-grade steel benefits Tata Steel, JSW, SAIL specialty units."},
        {"name": "China + 1 Strategy",      "type": "positive",
         "desc": "Global supply chain shift boosts Indian specialty chemicals, API, and materials players."},
    ],
    "Healthcare": [
        {"name": "PLI — Pharma & API",      "type": "positive",
         "desc": "₹15,000 Cr PLI for complex generics and API reduces China dependence. Sun, Dr Reddy, Cipla benefit."},
        {"name": "Ayushman Bharat (PMJAY)", "type": "positive",
         "desc": "70 Cr beneficiaries with ₹5L health cover drives hospital admissions and pharma volumes."},
        {"name": "Jan Aushadhi Generics",   "type": "mixed",
         "desc": "9,500+ stores selling generics at 50–90% discount limit branded pharma's domestic pricing power."},
    ],
    "Real Estate": [
        {"name": "PMAY Urban 2.0",          "type": "positive",
         "desc": "Interest subsidies and credit-linked schemes drive affordable and mid-segment housing demand."},
        {"name": "Smart Cities Mission",    "type": "positive",
         "desc": "₹2 lakh Cr urban development drives real estate demand in tier-2/3 cities."},
        {"name": "RERA Compliance",         "type": "mixed",
         "desc": "Consumer protection framework increases compliance costs but builds long-term buyer trust."},
    ],
    "Communication Services": [
        {"name": "5G Roll-Out",             "type": "positive",
         "desc": "Spectrum deployed; 5G drives ARPU growth, data monetization for Bharti Airtel and Jio."},
        {"name": "BharatNet Broadband",     "type": "positive",
         "desc": "Rural broadband expansion stimulates data consumption and drives telco revenue growth."},
    ],
    "Utilities": [
        {"name": "500 GW Renewables 2030",  "type": "positive",
         "desc": "India's clean energy target creates massive opportunity for NTPC, Adani Green, Tata Power."},
        {"name": "Electricity Policy 2022", "type": "positive",
         "desc": "24×7 power and grid modernisation targets drive capex in transmission and distribution."},
    ],
}


def _get_sector_schemes(sector: str) -> list:
    if not sector:
        return []
    for key, schemes in _SECTOR_SCHEMES.items():
        if key.lower() in sector.lower() or sector.lower() in key.lower():
            return schemes
    return []


# ── Entry / Exit timing engine ────────────────────────────────────────────────

def _calculate_entry_exit(cur: float, tech: dict, info: dict) -> dict:
    """
    Optimal buy zone, sell targets, stop-loss, R/R ratio, and holding duration.

    Methodology:
      • Support/resistance from Fibonacci retracement, pivot points, Bollinger Bands
      • Stop-loss sizing via ATR (Wilder's method)
      • Trade type classified by RSI × Stochastic × MA confluence
      • Risk/Reward ratio; minimum 1:1.5 considered tradeable
    """
    if not cur:
        return {}

    rsi     = tech.get('rsi', 50)
    sma50   = tech.get('sma_50')
    sma200  = tech.get('sma_200')
    bb_lo   = tech.get('bb_lower')
    bb_hi   = tech.get('bb_upper')
    macd    = tech.get('macd', 0) or 0
    macd_s  = tech.get('macd_signal', 0) or 0
    stoch_k = tech.get('stoch_k')
    will_r  = tech.get('williams_r')
    atr     = tech.get('atr') or cur * 0.018
    s1, s2  = tech.get('s1'), tech.get('s2')
    r1, r2  = tech.get('r1'), tech.get('r2')
    r3      = tech.get('r3')
    fib382  = tech.get('fib_38.2')
    fib500  = tech.get('fib_50.0')
    fib618  = tech.get('fib_61.8')
    fib786  = tech.get('fib_78.6')
    wk52hi  = tech.get('week_52_high')

    # Support candidates (buy zone sources)
    supports = sorted({round(v, 2) for v in filter(None, [
        sma200, sma50, bb_lo, fib618, fib500, fib382, s1, s2
    ])})

    # Resistance candidates (target sources)
    resists = sorted({round(v, 2) for v in filter(None, [
        bb_hi, r1, r2, r3, fib382, wk52hi
    ])})

    # Buy zone: nearest support below current price
    below = [s for s in supports if s < cur * 1.02]
    buy_lo = max(below) if below else round(cur * 0.94, 2)
    buy_hi = round(buy_lo + atr * 0.4, 2)

    # Stop loss: 1.5 × ATR below buy zone (floored at -12%)
    stop = max(round(buy_lo - 1.5 * atr, 2), round(buy_lo * 0.88, 2))

    # Targets: nearest + next resistance above current price
    above  = [r for r in resists if r > cur * 0.99]
    t1     = min(above) if above else round(cur * 1.12, 2)
    higher = [r for r in above if r > t1 * 1.02]
    t2     = min(higher) if higher else round(t1 * 1.10, 2)

    # Risk / Reward
    reward = t1 - buy_lo
    risk   = buy_lo - stop
    rr     = round(reward / risk, 2) if risk > 0 else None

    # Momentum confluence score
    bull = 0
    if rsi < 30:              bull += 3
    elif rsi < 45:            bull += 1
    if rsi > 70:              bull -= 3
    if stoch_k is not None:
        if stoch_k < 20:      bull += 2
        elif stoch_k > 80:    bull -= 2
    if will_r is not None:
        if will_r < -80:      bull += 2
        elif will_r > -20:    bull -= 2
    if macd > macd_s:         bull += 1
    if sma200 and cur > sma200: bull += 1
    if cur <= buy_hi:         bull += 1

    # Action + trade type + duration
    if rsi < 30 or (stoch_k is not None and stoch_k < 20):
        action, trade_type, duration = "Strong Buy Now", "Oversold reversal", "1–4 weeks"
    elif bull >= 4 and cur <= buy_hi * 1.01:
        action, trade_type, duration = "Buy / Accumulate", "Momentum entry", "1–3 months"
    elif bull >= 2 and cur > buy_hi * 1.01:
        action, trade_type, duration = "Wait for Dip", "Buy on pullback", "2–4 months"
    elif rsi > 70 or (stoch_k is not None and stoch_k > 80):
        action, trade_type, duration = "Book Profits", "Overbought exit", "Sell in 1–3 weeks"
    elif sma200 and cur > sma200 and rsi < 60:
        action, trade_type, duration = "Hold & Accumulate", "Long-term uptrend", "6–12 months"
    else:
        action, trade_type, duration = "Hold", "Sideways consolidation", "Review in 4–6 weeks"

    if rsi < 30:
        buy_timing = "Immediate — severely oversold, high-probability bounce"
    elif cur <= buy_hi * 1.01:
        buy_timing = f"At current levels — within buy zone ₹{buy_lo:,.0f}–₹{buy_hi:,.0f}"
    else:
        buy_timing = f"On dip to ₹{buy_lo:,.0f}–₹{buy_hi:,.0f} (support zone)"

    return {
        "action":          action,
        "trade_type":      trade_type,
        "buy_zone_low":    buy_lo,
        "buy_zone_high":   buy_hi,
        "buy_timing":      buy_timing,
        "target_1":        round(t1, 2),
        "target_2":        round(t2, 2),
        "stop_loss":       round(stop, 2),
        "rr_ratio":        rr,
        "duration":        duration,
        "momentum_score":  bull,
        "upside_1":        round((t1 - cur) / cur * 100, 1) if cur else None,
        "upside_2":        round((t2 - cur) / cur * 100, 1) if cur else None,
        "downside_risk":   round((cur - stop) / cur * 100, 1) if cur else None,
    }


# ── Advanced Technicals ───────────────────────────────────────────────────────

def _calculate_technicals(hist: pd.DataFrame) -> dict:
    """
    Full technical analysis suite based on Murphy's Technical Analysis of Financial Markets
    and standard quantitative methods used by professional traders.
    """
    if hist.empty or len(hist) < 14:
        return {}

    close  = hist['Close'].squeeze()
    high   = hist['High'].squeeze()  if 'High'   in hist.columns else close
    low    = hist['Low'].squeeze()   if 'Low'    in hist.columns else close
    volume = hist['Volume'].squeeze() if 'Volume' in hist.columns else None

    # ── RSI (14-period) — Wilder's relative strength index ───────────────────
    delta = close.diff()
    gain  = delta.where(delta > 0, 0.0).rolling(14).mean()
    loss  = (-delta.where(delta < 0, 0.0)).rolling(14).mean()
    rsi   = 100 - (100 / (1 + gain / loss.replace(0, float('nan'))))

    # ── Moving averages ───────────────────────────────────────────────────────
    _nan = lambda n: pd.Series([float('nan')] * n)
    sma50  = close.rolling(50).mean()  if len(close) >= 50  else _nan(len(close))
    sma200 = close.rolling(200).mean() if len(close) >= 200 else _nan(len(close))

    # ── MACD (12, 26, 9) — Gerald Appel's momentum indicator ─────────────────
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd  = ema12 - ema26
    sig   = macd.ewm(span=9, adjust=False).mean()
    macd_hist = macd - sig

    # ── Bollinger Bands (20-period, ±2σ) — John Bollinger ────────────────────
    sma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    bb_upper = sma20 + 2 * std20
    bb_lower = sma20 - 2 * std20
    bb_width = (bb_upper - bb_lower) / sma20  # bandwidth (volatility)

    # ── Stochastic Oscillator (14,%K; 3,%D) — George Lane ────────────────────
    low14  = low.rolling(14).min()
    high14 = high.rolling(14).max()
    pct_k  = 100 * (close - low14) / (high14 - low14).replace(0, float('nan'))
    pct_d  = pct_k.rolling(3).mean()

    # ── Williams %R (14-period) — Larry Williams ──────────────────────────────
    willy_r = -100 * (high14 - close) / (high14 - low14).replace(0, float('nan'))

    # ── ATR (14-period Average True Range) — J. Welles Wilder ────────────────
    tr = pd.concat([
        high - low,
        (high - close.shift(1)).abs(),
        (low  - close.shift(1)).abs(),
    ], axis=1).max(axis=1)
    atr = tr.rolling(14).mean()

    # ── OBV (On Balance Volume) — Joseph Granville ───────────────────────────
    obv_trend = None
    if volume is not None:
        direction = close.diff().apply(lambda x: 1 if x > 0 else -1 if x < 0 else 0)
        obv     = (volume * direction).cumsum()
        obv_sma = obv.rolling(20).mean()
        obv_trend = "rising" if _safe_float(obv.iloc[-1], 0) > _safe_float(obv_sma.iloc[-1], 0) else "falling"

    # ── Ichimoku Cloud (Tenkan + Kijun + signals) ─────────────────────────────
    tenkan = (high.rolling(9).max()  + low.rolling(9).min())  / 2  # 9-period
    kijun  = (high.rolling(26).max() + low.rolling(26).min()) / 2  # 26-period

    # ── Pivot Points (standard daily — from last session) ────────────────────
    ph, pl, pc = _safe_float(high.iloc[-1]), _safe_float(low.iloc[-1]), _safe_float(close.iloc[-1])
    pivot = round((ph + pl + pc) / 3, 2) if all([ph, pl, pc]) else None
    if pivot and ph and pl:
        r1 = round(2 * pivot - pl, 2)
        s1 = round(2 * pivot - ph, 2)
        r2 = round(pivot + (ph - pl), 2)
        s2 = round(pivot - (ph - pl), 2)
        r3 = round(ph + 2 * (pivot - pl), 2)
        s3 = round(pl - 2 * (ph - pivot), 2)
    else:
        r1 = s1 = r2 = s2 = r3 = s3 = None

    # ── 52-week range & Fibonacci retracement ────────────────────────────────
    cur       = _safe_float(close.iloc[-1])
    s50       = _safe_float(sma50.iloc[-1])
    s200      = _safe_float(sma200.iloc[-1])
    wk52_high = _safe_float(close.rolling(252).max().iloc[-1])
    wk52_low  = _safe_float(close.rolling(252).min().iloc[-1])
    wk52_pct  = round((cur - wk52_high) / wk52_high * 100, 2) if wk52_high and cur else None

    fib = {}
    if wk52_high and wk52_low:
        rng = wk52_high - wk52_low
        for lvl, ratio in [(23.6, 0.236), (38.2, 0.382), (50.0, 0.500), (61.8, 0.618), (78.6, 0.786)]:
            fib[f"fib_{lvl}"] = round(wk52_high - ratio * rng, 2)

    # ── Volume ────────────────────────────────────────────────────────────────
    vol_avg = _safe_float(volume.rolling(20).mean().iloc[-1]) if volume is not None else None

    # ── Golden / Death cross ──────────────────────────────────────────────────
    cross = ("golden" if s50 and s200 and s50 > s200 else
             "death"  if s50 and s200 and s50 < s200 else None)

    # ── Ichimoku signal ───────────────────────────────────────────────────────
    ten_v = _safe_float(tenkan.iloc[-1])
    kij_v = _safe_float(kijun.iloc[-1])
    ichi  = ("bullish" if cur and ten_v and kij_v and cur > ten_v and cur > kij_v else
             "bearish" if cur and ten_v and kij_v and cur < ten_v and cur < kij_v else
             "neutral")

    return {
        # Core indicators
        "rsi":              round(_safe_float(rsi.iloc[-1], 50), 2),
        "sma_50":           round(s50, 2)  if s50  else None,
        "sma_200":          round(s200, 2) if s200 else None,
        "macd":             round(_safe_float(macd.iloc[-1], 0), 4),
        "macd_signal":      round(_safe_float(sig.iloc[-1], 0), 4),
        "macd_histogram":   round(_safe_float(macd_hist.iloc[-1], 0), 4),
        "bb_upper":         round(_safe_float(bb_upper.iloc[-1], 0), 2),
        "bb_lower":         round(_safe_float(bb_lower.iloc[-1], 0), 2),
        "bb_width":         round(_safe_float(bb_width.iloc[-1], 0), 4),
        "price_vs_sma50":   "above" if (cur and s50  and cur > s50)  else "below",
        "price_vs_sma200":  "above" if (cur and s200 and cur > s200) else "below",
        "volume_avg":       round(vol_avg, 0) if vol_avg else None,
        "week_52_high":     round(wk52_high, 2) if wk52_high else None,
        "week_52_low":      round(wk52_low, 2)  if wk52_low  else None,
        "week_52_pct":      wk52_pct,
        # Advanced oscillators
        "stoch_k":          round(_safe_float(pct_k.iloc[-1], 50), 2),
        "stoch_d":          round(_safe_float(pct_d.iloc[-1], 50), 2),
        "williams_r":       round(_safe_float(willy_r.iloc[-1], -50), 2),
        "atr":              round(_safe_float(atr.iloc[-1], 0), 2),
        "obv_trend":        obv_trend,
        # Ichimoku
        "tenkan":           round(ten_v, 2) if ten_v else None,
        "kijun":            round(kij_v, 2) if kij_v else None,
        "ichimoku_signal":  ichi,
        # MA cross
        "cross":            cross,
        # Pivot points
        "pivot":            pivot,
        "r1": r1, "r2": r2, "r3": r3,
        "s1": s1, "s2": s2, "s3": s3,
        # Fibonacci retracement
        **fib,
    }


# ── Recommendation engine ─────────────────────────────────────────────────────

def _generate_recommendation(
    info: dict, technicals: dict, sentiment_score: float = 0.0
) -> dict:
    """Build a composite recommendation signal from fundamentals, technicals, and sentiment.

    Each positive signal contributes ``+1`` to ``+3`` points; each negative
    signal contributes ``-1`` to ``-3``.  The final score maps to:
    ``Strong Buy`` (≥8), ``Buy`` (≥3), ``Hold`` (−2 to 2),
    ``Sell`` (≤−3), ``Strong Sell`` (≤−8).

    Args:
        info: ``yf.Ticker.info`` dict for the stock.
        technicals: Output of ``_calculate_technicals()``.
        sentiment_score: News sentiment float in range ``[-1, +1]`` (0 = neutral).

    Returns:
        Dict with keys ``signal``, ``score``, ``color``, and ``reasons``
        (list of human-readable explanation strings).
    """
    score   = 0
    reasons = []

    rsi = technicals.get('rsi')
    if rsi is not None:
        if rsi < 30:
            score += 3;  reasons.append(f"Strongly oversold (RSI {rsi:.0f}) — potential reversal")
        elif rsi < 42:
            score += 1;  reasons.append(f"Mild oversold zone (RSI {rsi:.0f})")
        elif rsi > 72:
            score -= 3;  reasons.append(f"Heavily overbought (RSI {rsi:.0f}) — sell pressure likely")
        elif rsi > 60:
            score -= 1;  reasons.append(f"Approaching overbought (RSI {rsi:.0f})")

    if technicals.get('price_vs_sma200') == 'above':
        score += 2;  reasons.append("Trading above 200-day MA — long-term uptrend")
    else:
        score -= 2;  reasons.append("Below 200-day MA — long-term downtrend")

    if technicals.get('price_vs_sma50') == 'above':
        score += 1;  reasons.append("Above 50-day MA — short-term momentum positive")
    else:
        score -= 1;  reasons.append("Below 50-day MA — short-term momentum negative")

    macd = technicals.get('macd', 0) or 0
    msig = technicals.get('macd_signal', 0) or 0
    if macd > msig:
        score += 1;  reasons.append("MACD bullish crossover")
    else:
        score -= 1;  reasons.append("MACD bearish crossover")

    # Bollinger Band position
    cur   = _safe_float(info.get('currentPrice') or info.get('regularMarketPrice'))
    bb_lo = technicals.get('bb_lower')
    bb_hi = technicals.get('bb_upper')
    if cur and bb_lo and bb_hi:
        if cur < bb_lo:
            score += 1;  reasons.append("Price near lower Bollinger Band — oversold area")
        elif cur > bb_hi:
            score -= 1;  reasons.append("Price near upper Bollinger Band — overbought area")

    div_yield = _normalise_yield(
        info.get('trailingAnnualDividendYield') or info.get('dividendYield')
    ) or 0.0
    if div_yield > 0.06:
        score += 3;  reasons.append(f"Excellent dividend yield ({div_yield*100:.1f}%)")
    elif div_yield > 0.04:
        score += 2;  reasons.append(f"High dividend yield ({div_yield*100:.1f}%)")
    elif div_yield > 0.025:
        score += 1;  reasons.append(f"Decent dividend yield ({div_yield*100:.1f}%)")
    elif div_yield < 0.005:
        reasons.append("Low or no dividend income")

    # Payout ratio safety
    pr = _safe_float(info.get('payoutRatio'), 0)
    if 0 < pr < 0.60:
        score += 1;  reasons.append(f"Sustainable payout ratio ({pr*100:.0f}%)")
    elif pr > 0.90:
        score -= 1;  reasons.append(f"Very high payout ratio ({pr*100:.0f}%) — dividend at risk")

    # Revenue / earnings growth
    rev_g = _safe_float(info.get('revenueGrowth'), 0)
    ear_g = _safe_float(info.get('earningsGrowth'), 0)
    if rev_g > 0.15:
        score += 1;  reasons.append(f"Strong revenue growth ({rev_g*100:.0f}% YoY)")
    elif rev_g < -0.05:
        score -= 1;  reasons.append(f"Revenue declining ({rev_g*100:.0f}% YoY)")
    if ear_g > 0.15:
        score += 1;  reasons.append(f"Earnings growth {ear_g*100:.0f}% YoY")
    elif ear_g < -0.10:
        score -= 1;  reasons.append(f"Earnings declining ({ear_g*100:.0f}%)")

    # Valuation: P/E
    pe = _safe_float(info.get('trailingPE'))
    if pe and pe > 0:
        if pe < 12:
            score += 2;  reasons.append(f"Attractive valuation (P/E {pe:.1f})")
        elif pe < 20:
            score += 1;  reasons.append(f"Reasonable valuation (P/E {pe:.1f})")
        elif pe > 60:
            score -= 2;  reasons.append(f"Expensive valuation (P/E {pe:.1f})")
        elif pe > 35:
            score -= 1;  reasons.append(f"High valuation (P/E {pe:.1f})")

    # Debt
    de = _safe_float(info.get('debtToEquity'))
    if de is not None:
        if de < 0.3:
            score += 1;  reasons.append(f"Low debt-to-equity ({de:.2f})")
        elif de > 2.0:
            score -= 1;  reasons.append(f"High leverage (D/E {de:.2f})")

    # Sentiment overlay
    if sentiment_score > 0.4:
        score += 2;  reasons.append("Strong bullish news sentiment")
    elif sentiment_score > 0.15:
        score += 1;  reasons.append("Mildly positive news sentiment")
    elif sentiment_score < -0.4:
        score -= 2;  reasons.append("Strong bearish news sentiment")
    elif sentiment_score < -0.15:
        score -= 1;  reasons.append("Negative news sentiment")

    # Map score → signal
    if score >= 8:
        signal, color = "Strong Buy", "green"
    elif score >= 3:
        signal, color = "Buy", "green"
    elif score <= -8:
        signal, color = "Strong Sell", "red"
    elif score <= -3:
        signal, color = "Sell", "red"
    else:
        signal, color = "Hold", "orange"

    return {"signal": signal, "score": score, "color": color, "reasons": reasons}


# ── Public API ────────────────────────────────────────────────────────────────

def search_stocks(query: str) -> list:
    """Search the full NSE equity universe by ticker symbol or company name.

    Applies a ranked four-pass strategy so that exact symbol matches rank
    first, then symbol-prefix matches, then company-name prefix, then
    substring matches.  Duplicates are suppressed.

    Args:
        query: Search string typed by the user (case-insensitive).

    Returns:
        Up to 20 dicts, each with ``symbol`` and ``company_name`` keys.
    """
    q   = query.strip().upper()
    uni = _get_nse_universe()
    seen: set   = set()
    results: list = []

    def _add(sym, name):
        if sym not in seen:
            seen.add(sym)
            results.append({"symbol": sym, "company_name": name})

    for sym, name in uni.items():                           # exact symbol
        if sym.replace(".NS", "") == q:
            _add(sym, name)
    for sym, name in uni.items():                           # symbol prefix
        if sym.replace(".NS", "").startswith(q):
            _add(sym, name)
    for sym, name in uni.items():                           # company prefix
        if name.upper().startswith(q):
            _add(sym, name)
    for sym, name in uni.items():                           # contains
        if q in sym.upper() or q in name.upper():
            _add(sym, name)

    return results[:20]


def get_stock_analysis(symbol: str, sentiment_score: float = 0.0) -> dict:
    """Return a comprehensive stock analysis for *symbol*.

    Fetches ``yf.Ticker.info`` and 2 years of OHLCV history, then computes
    technicals, a composite recommendation, Graham/Lynch valuation metrics,
    entry/exit timing, and relevant government scheme impacts.

    Results are cached for ``_CACHE_TTL_ANALYSIS`` seconds to avoid
    hammering Yahoo Finance on repeated requests for the same symbol.

    Args:
        symbol: Yahoo Finance ticker symbol (e.g. ``"TCS.NS"``).
        sentiment_score: News sentiment in ``[-1, +1]`` merged into the
            composite score.  Pass ``0.0`` when sentiment is unavailable.

    Returns:
        Dict with ``symbol``, ``current_price``, ``technicals``,
        ``recommendation``, ``valuation``, ``entry_exit``, and other fields.
        Returns ``{"symbol": ..., "error": ...}`` on failure.
    """
    def _fetch():
        info = _yf_info(symbol)
        hist = _yf_history(symbol, "2y")

        cur_price  = _safe_float(info.get('currentPrice') or info.get('regularMarketPrice'))
        prev_close = _safe_float(info.get('previousClose') or info.get('regularMarketPreviousClose'))
        chg_pct    = (
            round((cur_price - prev_close) / prev_close * 100, 2)
            if cur_price and prev_close and prev_close != 0 else None
        )
        sector     = info.get('sector', '')
        technicals = _calculate_technicals(hist)
        rec        = _generate_recommendation(info, technicals, sentiment_score)
        valuation  = _calc_valuation_metrics(info)
        entry_exit = _calculate_entry_exit(cur_price, technicals, info) if cur_price else {}
        schemes    = _get_sector_schemes(sector)

        return {
            "symbol":          symbol,
            "company_name":    info.get('longName') or info.get('shortName') or NSE_UNIVERSE.get(symbol),
            "sector":          sector,
            "industry":        info.get('industry'),
            "current_price":   cur_price,
            "change_pct":      chg_pct,
            "market_cap":      _safe_float(info.get('marketCap')),
            "pe_ratio":        _safe_float(info.get('trailingPE')),
            "pb_ratio":        _safe_float(info.get('priceToBook')),
            "eps":             _safe_float(info.get('trailingEps')),
            "dividend_yield":  _normalise_yield(
                                   info.get('trailingAnnualDividendYield')
                                   or info.get('dividendYield')),
            "payout_ratio":    _safe_float(info.get('payoutRatio')),
            "revenue_growth":  _safe_float(info.get('revenueGrowth')),
            "earnings_growth": _safe_float(info.get('earningsGrowth')),
            "debt_to_equity":  _safe_float(info.get('debtToEquity')),
            "roe":             _safe_float(info.get('returnOnEquity')),
            "exchange":        info.get('exchange'),
            "currency":        info.get('currency', 'INR'),
            "technicals":      technicals,
            "recommendation":  rec,
            "valuation":       valuation,
            "entry_exit":      entry_exit,
            "sector_schemes":  schemes,
        }

    try:
        return _cached(f"analysis:{symbol}", _fetch, ttl=_CACHE_TTL_ANALYSIS)
    except Exception as exc:
        logger.warning("Analysis failed for %s: %s", symbol, exc)
        return {"symbol": symbol, "error": str(exc)}


def get_chart_data(symbol: str, period: str = "1y") -> list:
    """Return OHLCV candlestick data for *symbol* over *period*.

    Invalid period strings are silently normalised to ``"1y"``.
    Timezone info is stripped from the date index so JSON serialisation works.

    Args:
        symbol: Yahoo Finance ticker symbol.
        period: History period — one of ``"1d"``, ``"5d"``, ``"1mo"``,
            ``"3mo"``, ``"6mo"``, ``"1y"``, ``"2y"``, ``"5y"``, ``"10y"``,
            ``"max"``.

    Returns:
        List of OHLCV dicts with keys ``date``, ``open``, ``high``, ``low``,
        ``close``, ``volume``.  Empty list on failure.
    """
    valid_periods = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"}
    if period not in valid_periods:
        period = "1y"

    def _fetch():
        hist = _yf_history(symbol, period)
        if hist.empty:
            return []
        hist.index = hist.index.tz_localize(None) if hist.index.tz is not None else hist.index
        records = []
        for dt, row in hist.iterrows():
            records.append({
                "date":   dt.strftime("%Y-%m-%d"),
                "open":   round(float(row['Open']),   2),
                "high":   round(float(row['High']),   2),
                "low":    round(float(row['Low']),    2),
                "close":  round(float(row['Close']),  2),
                "volume": float(row['Volume']),
            })
        return records

    try:
        return _cached(f"chart:{symbol}:{period}", _fetch, ttl=_CACHE_TTL_CHART)
    except Exception as exc:
        logger.warning("Chart data failed for %s: %s", symbol, exc)
        return []


def screen_stocks(min_yield: float = 0.03, max_pe: float = 50.0, min_score: int = 2) -> list:
    """
    Screen NSE_UNIVERSE for quality stocks.
    Uses a 60-min cache so the full 89-stock pass runs at most once per hour.
    Throttles 0.8 s between un-cached calls to respect Yahoo Finance rate limits.
    """
    cache_key = f"screener:{min_yield:.3f}:{max_pe:.1f}"
    cached_entry = _cache.get(cache_key)
    if cached_entry and time.time() - cached_entry['ts'] < _CACHE_TTL_SCREENER:
        logger.info("Screener cache hit")
        return cached_entry['data']

    results = []
    symbols = list(NSE_UNIVERSE.keys())

    for sym in symbols:
        # Only sleep if this symbol isn't already cached
        if f"analysis:{sym}" not in _cache:
            time.sleep(0.8)   # 0.8 s per new request → ~70 s for 89 stocks
        try:
            data = get_stock_analysis(sym, 0.0)
            if data.get('error'):
                continue
            dy   = data.get('dividend_yield') or 0
            pe   = data.get('pe_ratio')       or 999
            sc   = (data.get('recommendation') or {}).get('score', 0)
            sig  = (data.get('recommendation') or {}).get('signal', 'Hold')
            tech = data.get('technicals') or {}
            val  = data.get('valuation')   or {}
            ee   = data.get('entry_exit')  or {}
            # when min_yield == 0: no dividend filter — show all stocks
            div_ok = (min_yield == 0) or (dy >= min_yield)
            if div_ok and pe <= max_pe:
                results.append({
                    "symbol":           sym,
                    "company_name":     data.get('company_name'),
                    "sector":           data.get('sector'),
                    "current_price":    data.get('current_price'),
                    "change_pct":       data.get('change_pct'),
                    "dividend_yield":   dy,
                    "pe_ratio":         pe if pe < 999 else None,
                    "market_cap":       data.get('market_cap'),
                    "rsi":              tech.get('rsi'),
                    "stoch_k":          tech.get('stoch_k'),
                    "atr":              tech.get('atr'),
                    "bb_width":         tech.get('bb_width'),
                    "macd_histogram":   tech.get('macd_histogram'),
                    "price_vs_sma50":   tech.get('price_vs_sma50'),
                    "price_vs_sma200":  tech.get('price_vs_sma200'),
                    "ichimoku_signal":  tech.get('ichimoku_signal'),
                    "obv_trend":        tech.get('obv_trend'),
                    "week_52_pct":      tech.get('week_52_pct'),
                    "valuation_verdict":val.get('verdict'),
                    "margin_of_safety": val.get('margin_of_safety'),
                    "entry_action":     ee.get('action'),
                    "signal":           sig,
                    "score":            sc,
                })
        except Exception as exc:
            logger.debug("Screener skip %s: %s", sym, exc)
            continue

    # sort: by score when no dividend filter, else by dividend yield then score
    if min_yield == 0:
        results.sort(key=lambda x: -(x.get('score') or 0))
    else:
        results.sort(key=lambda x: (-(x.get('dividend_yield') or 0), -(x.get('score') or 0)))
    top = results[:40]
    _cache[cache_key] = {'ts': time.time(), 'data': top}
    return top


def calculate_portfolio(transactions: list) -> dict:
    """Calculate current holdings and profit/loss from a list of transaction records.

    Supports ``"buy"``, ``"sell"``, and ``"dividend"`` transaction types.
    Sells reduce the cost basis proportionally using the average cost method.
    Dividends are tracked separately and added to realised P&L.

    Args:
        transactions: List of ORM ``StockTransaction`` objects with attributes
            ``symbol``, ``quantity``, ``total_amount``, ``transaction_type``,
            and ``company_name``.

    Returns:
        Dict with ``total_invested``, ``current_value``, ``total_pnl``,
        ``pnl_pct``, and ``holdings`` (list of per-symbol summary dicts).
    """
    holdings: dict = {}

    for t in transactions:
        sym  = t.symbol
        qty  = t.quantity
        amt  = t.total_amount
        typ  = t.transaction_type

        if sym not in holdings:
            holdings[sym] = {"symbol": sym, "company_name": t.company_name,
                             "qty": 0.0, "cost_basis": 0.0, "dividends": 0.0}

        if typ == "buy":
            holdings[sym]["qty"]        += qty
            holdings[sym]["cost_basis"] += amt
        elif typ == "sell":
            if holdings[sym]["qty"] > 0:
                avg = holdings[sym]["cost_basis"] / holdings[sym]["qty"]
                holdings[sym]["cost_basis"] -= avg * qty
            holdings[sym]["qty"] -= qty
        elif typ == "dividend":
            holdings[sym]["dividends"] += amt

    total_invested = 0.0
    current_value  = 0.0
    summary        = []

    for sym, h in holdings.items():
        if h["qty"] <= 0:
            continue
        try:
            info  = _yf_info(sym)
            price = _safe_float(info.get('currentPrice') or info.get('regularMarketPrice')) or 0.0
        except Exception:
            price = 0.0

        cur_val = price * h["qty"]
        cost    = h["cost_basis"]
        pnl     = cur_val - cost + h["dividends"]
        pnl_pct = (pnl / cost * 100) if cost else 0

        total_invested += cost
        current_value  += cur_val

        summary.append({
            "symbol":        sym,
            "company_name":  h["company_name"],
            "qty":           round(h["qty"], 4),
            "avg_cost":      round(cost / h["qty"], 2) if h["qty"] else 0,
            "current_price": round(price, 2),
            "cost_basis":    round(cost, 2),
            "current_value": round(cur_val, 2),
            "dividends":     round(h["dividends"], 2),
            "pnl":           round(pnl, 2),
            "pnl_pct":       round(pnl_pct, 2),
        })

    total_pnl = current_value - total_invested
    return {
        "total_invested": round(total_invested, 2),
        "current_value":  round(current_value, 2),
        "total_pnl":      round(total_pnl, 2),
        "pnl_pct":        round(total_pnl / total_invested * 100, 2) if total_invested else 0,
        "holdings":       sorted(summary, key=lambda x: -abs(x["pnl"])),
    }


# ── Fast basic quote (fast_info, <1 s) ────────────────────────────────────────

def get_basic_quote(symbol: str) -> dict:
    """Return an ultra-fast price quote using ``yf.Ticker.fast_info``.

    ``fast_info`` skips the heavy ``info`` JSON download and responds in under
    1 second.  Used to populate the stock header immediately while the full
    analysis (``get_stock_analysis``) loads in the background.

    Results are cached for ``_CACHE_TTL_BASIC_QUOTE`` seconds.

    Args:
        symbol: Yahoo Finance ticker symbol.

    Returns:
        Dict with ``symbol``, ``current_price``, ``change_pct``,
        ``year_high``, ``year_low``, ``sma_50``, ``sma_200``, etc.
        Returns ``{"symbol": ..., "error": ...}`` on failure.
    """
    cache_key = f"basic:{symbol}"
    entry = _cache.get(cache_key)
    if entry and time.time() - entry["ts"] < _CACHE_TTL_BASIC_QUOTE:
        return entry["data"]
    try:
        fi   = dict(_ticker(symbol).fast_info)
        cur  = _safe_float(fi.get("lastPrice"))
        prev = _safe_float(fi.get("regularMarketPreviousClose"))
        chg  = (
            round((cur - prev) / prev * 100, 2)
            if cur and prev and prev != 0 else None
        )
        universe = _get_nse_universe()
        result = {
            "symbol":         symbol,
            "company_name":   universe.get(symbol) or symbol.replace(".NS", ""),
            "current_price":  cur,
            "previous_close": prev,
            "change_pct":     chg,
            "year_high":      _safe_float(fi.get("yearHigh")),
            "year_low":       _safe_float(fi.get("yearLow")),
            "sma_50":         _safe_float(fi.get("fiftyDayAverage")),
            "sma_200":        _safe_float(fi.get("twoHundredDayAverage")),
            "market_cap":     _safe_float(fi.get("marketCap")),
            "volume":         _safe_float(fi.get("lastVolume")),
            "currency":       fi.get("currency", "INR"),
            "exchange":       fi.get("exchange", "NSE"),
        }
        _cache[cache_key] = {"ts": time.time(), "data": result}
        return result
    except Exception as exc:
        logger.warning("basic_quote failed for %s: %s", symbol, exc)
        return {"symbol": symbol, "error": str(exc)}


# ── Global market indices ─────────────────────────────────────────────────────

_GLOBAL_INDICES = {
    "^NSEI":    {"name": "Nifty 50",   "region": "India",     "flag": "🇮🇳"},
    "^BSESN":   {"name": "Sensex",     "region": "India",     "flag": "🇮🇳"},
    "^GSPC":    {"name": "S&P 500",    "region": "USA",       "flag": "🇺🇸"},
    "^IXIC":    {"name": "NASDAQ",     "region": "USA",       "flag": "🇺🇸"},
    "^DJI":     {"name": "Dow Jones",  "region": "USA",       "flag": "🇺🇸"},
    "^N225":    {"name": "Nikkei 225", "region": "Japan",     "flag": "🇯🇵"},
    "^FTSE":    {"name": "FTSE 100",   "region": "UK",        "flag": "🇬🇧"},
    "^HSI":     {"name": "Hang Seng",  "region": "HK",        "flag": "🇭🇰"},
    "GC=F":     {"name": "Gold",       "region": "Commodity", "flag": "🥇"},
    "CL=F":     {"name": "Crude Oil",  "region": "Commodity", "flag": "🛢️"},
    "USDINR=X": {"name": "USD/INR",    "region": "FX",        "flag": "💱"},
}


def get_global_markets() -> list:
    """Fetch a snapshot of global market indices in parallel.

    Uses ``ThreadPoolExecutor`` (6 workers) to fetch all ``_GLOBAL_INDICES``
    simultaneously.  Individual failures return ``None`` prices without
    crashing the entire request.  Cached for ``_CACHE_TTL_GLOBAL`` seconds.

    Returns:
        List of dicts (one per index) with ``symbol``, ``name``, ``region``,
        ``flag``, ``price``, ``change_pct``, and ``currency`` keys, in the
        same order as ``_GLOBAL_INDICES``.
    """
    cache_key = "global_markets"
    entry = _cache.get(cache_key)
    if entry and time.time() - entry["ts"] < _CACHE_TTL_GLOBAL:
        return entry["data"]

    def _one(sym, meta):
        try:
            fi   = dict(_ticker(sym).fast_info)
            cur  = _safe_float(fi.get("lastPrice"))
            prev = _safe_float(fi.get("regularMarketPreviousClose"))
            chg  = round((cur - prev) / prev * 100, 2) if cur and prev and prev != 0 else None
            return {
                "symbol": sym, "name": meta["name"],
                "region": meta["region"], "flag": meta["flag"],
                "price":  cur, "change_pct": chg,
                "currency": fi.get("currency", ""),
            }
        except Exception:
            return {
                "symbol": sym, "name": meta["name"],
                "region": meta["region"], "flag": meta["flag"],
                "price": None, "change_pct": None, "currency": "",
            }

    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(_one, sym, meta): sym
                   for sym, meta in _GLOBAL_INDICES.items()}
        by_sym: dict = {}
        for fut in as_completed(futures):
            by_sym[futures[fut]] = fut.result()

    results = [by_sym[s] for s in _GLOBAL_INDICES]
    _cache[cache_key] = {"ts": time.time(), "data": results}
    return results


# ── Detailed financial statements ────────────────────────────────────────────

def _extract_fin_rows(df: "pd.DataFrame", keys: dict, divisor: float) -> tuple:
    """Extract labelled rows from a yfinance financial statement DataFrame.

    Args:
        df: A ``pandas.DataFrame`` whose index contains financial statement
            line items (e.g. ``"Total Revenue"``, ``"Net Income"``).
        keys: Mapping of raw yfinance row names → human-readable display labels.
        divisor: Monetary divisor to apply (``1e7`` for Indian Crores,
            ``1e6`` for USD Millions).  Not applied to ``_PER_SHARE_ROWS``
            or ``_COUNT_ROWS``.

    Returns:
        A ``(rows, periods)`` tuple where ``rows`` is a list of
        ``{"label": str, "values": [float|None]}`` dicts and ``periods``
        is a list of ``"YYYY-MM-DD"`` date strings from the column headers.
    """
    if df is None or df.empty:
        return [], []
    periods = [str(c)[:10] for c in df.columns]
    rows = []
    for raw_key, label in keys.items():
        if raw_key not in df.index:
            continue
        if raw_key in _PER_SHARE_ROWS or raw_key in _COUNT_ROWS:
            div = 1.0
        else:
            div = divisor
        vals = []
        for v in df.loc[raw_key]:
            try:
                fv = float(v)
                vals.append(None if pd.isna(fv) else round(fv / div, 2))
            except (TypeError, ValueError):
                vals.append(None)
        rows.append({"label": label, "values": vals})
    return rows, periods


def get_detailed_financials(symbol: str) -> dict:
    """Fetch full financial statements from yfinance and return structured data.

    Fetches Income Statement (annual + quarterly), Balance Sheet, Cash Flow
    Statement, key financial ratios, and capital structure.  Monetary values
    are scaled to Crores (INR) or Millions (USD) depending on the stock's
    reporting currency.

    Results are cached for ``_CACHE_TTL_FINANCIALS`` seconds because quarterly
    financials change at most four times a year.

    Args:
        symbol: Yahoo Finance ticker symbol.

    Returns:
        Dict with sections ``profit_loss``, ``balance_sheet``, ``cash_flows``,
        ``ratios``, and ``capital_structure``.
        Returns ``{"symbol": ..., "error": ...}`` on failure.
    """
    cache_key = f"financials:{symbol}"
    entry = _cache.get(cache_key)
    if entry and time.time() - entry["ts"] < _CACHE_TTL_FINANCIALS:
        return entry["data"]

    try:
        ticker  = _ticker(symbol)
        info    = _yf_info(symbol)
        cur     = _safe_float(info.get('currentPrice') or info.get('regularMarketPrice'))
        cy      = info.get('currency', 'INR')
        is_inr  = cy == 'INR'
        unit    = 'Cr' if is_inr else 'M'
        divisor = 1e7 if is_inr else 1e6

        def _sdf(attr):
            try:
                df = getattr(ticker, attr)
                return df if (df is not None and not df.empty) else pd.DataFrame()
            except Exception:
                return pd.DataFrame()

        # ── Income Statement ──────────────────────────────────────────────────
        PL_KEYS = {
            'Total Revenue':                               'Revenue',
            'Cost Of Revenue':                             'Cost of Revenue / COGS',
            'Gross Profit':                                'Gross Profit',
            'Selling General And Administration':          'SG&A / Opex',
            'Depreciation And Amortization In Income Statement': 'Depreciation & Amortisation',
            'Operating Expense':                           'Total Operating Expenses',
            'Operating Income':                            'Operating Profit (EBIT)',
            'EBITDA':                                      'EBITDA',
            'Interest Expense':                            'Interest Expense',
            'Pretax Income':                               'Profit Before Tax (PBT)',
            'Tax Provision':                               'Tax',
            'Net Income':                                  'Net Profit (PAT)',
            'Basic EPS':                                   'EPS – Basic (₹)',
            'Diluted EPS':                                 'EPS – Diluted (₹)',
        }
        pl_a_rows, pl_a_per = _extract_fin_rows(_sdf('income_stmt'),           PL_KEYS, divisor)
        pl_q_rows, pl_q_per = _extract_fin_rows(_sdf('quarterly_income_stmt'), PL_KEYS, divisor)

        # ── Balance Sheet ─────────────────────────────────────────────────────
        bs_df = _sdf('balance_sheet')
        BS_ASSETS = {
            'Cash And Cash Equivalents':                     'Cash & Equivalents',
            'Cash Cash Equivalents And Short Term Investments': 'Cash + ST Investments',
            'Gross Accounts Receivable':                     'Gross Accounts Receivable',
            'Accounts Receivable':                           'Net Accounts Receivable',
            'Inventory':                                     'Inventory',
            'Current Assets':                                'Total Current Assets',
            'Net PPE':                                       'Net Fixed Assets (PP&E)',
            'Goodwill And Other Intangible Assets':          'Goodwill & Intangibles',
            'Total Assets':                                  'Total Assets',
        }
        BS_LIAB = {
            'Accounts Payable':                              'Accounts Payable',
            'Current Liabilities':                           'Total Current Liabilities',
            'Long Term Debt And Capital Lease Obligation':   'Long-term Debt',
            'Total Debt':                                    'Total Debt',
            'Total Liabilities Net Minority Interest':       'Total Liabilities',
        }
        BS_EQUITY = {
            'Common Stock':                                  'Share Capital',
            'Additional Paid In Capital':                    'Share Premium / APIC',
            'Retained Earnings':                             'Retained Earnings',
            'Stockholders Equity':                           "Shareholders' Equity",
            'Ordinary Shares Number':                        'Shares Outstanding (nos.)',
        }
        bs_per   = [str(c)[:10] for c in bs_df.columns] if not bs_df.empty else []
        bs_assets = _extract_fin_rows(bs_df, BS_ASSETS, divisor)[0]
        bs_liabs  = _extract_fin_rows(bs_df, BS_LIAB,   divisor)[0]
        bs_equity = _extract_fin_rows(bs_df, BS_EQUITY, divisor)[0]

        # ── Cash Flow ─────────────────────────────────────────────────────────
        CF_KEYS = {
            'Net Income From Continuing Operations':  'Net Profit',
            'Depreciation And Amortization':          'Add: D&A',
            'Change In Working Capital':              'Change in Working Capital',
            'Operating Cash Flow':                    'Net Cash from Operations',
            'Purchase Of PPE':                        'Capex – Plant & Equipment',
            'Capital Expenditure':                    'Total Capital Expenditure',
            'Free Cash Flow':                         'Free Cash Flow (FCF)',
            'Purchase Of Business':                   'Acquisitions',
            'Investing Cash Flow':                    'Net Cash from Investing',
            'Cash Dividends Paid':                    'Dividends Paid',
            'Repurchase Of Capital Stock':            'Share Buybacks',
            'Net Common Stock Issuance':              'Net Equity Raised',
            'Financing Cash Flow':                    'Net Cash from Financing',
        }
        cf_a_rows, cf_a_per = _extract_fin_rows(_sdf('cashflow'),           CF_KEYS, divisor)
        cf_q_rows, cf_q_per = _extract_fin_rows(_sdf('quarterly_cashflow'), CF_KEYS, divisor)

        # ── Ratios (current) ──────────────────────────────────────────────────
        ev         = _safe_float(info.get('enterpriseValue'))
        ebitda_raw = _safe_float(info.get('ebitda'))
        ratios = {
            # Valuation
            "pe_trailing":       _safe_float(info.get('trailingPE')),
            "pe_forward":        _safe_float(info.get('forwardPE')),
            "pb_ratio":          _safe_float(info.get('priceToBook')),
            "ps_ratio":          _safe_float(info.get('priceToSalesTrailing12Months')),
            "peg_ratio":         _safe_float(info.get('pegRatio')),
            "ev_ebitda":         round(ev / ebitda_raw, 2) if (ev and ebitda_raw) else None,
            "ev_revenue":        _safe_float(info.get('enterpriseToRevenue')),
            # Profitability
            "gross_margin":      _safe_float(info.get('grossMargins')),
            "ebitda_margin":     _safe_float(info.get('ebitdaMargins')),
            "operating_margin":  _safe_float(info.get('operatingMargins')),
            "net_margin":        _safe_float(info.get('profitMargins')),
            # Returns
            "roe":               _safe_float(info.get('returnOnEquity')),
            "roa":               _safe_float(info.get('returnOnAssets')),
            # Liquidity & Leverage
            "current_ratio":     _safe_float(info.get('currentRatio')),
            "quick_ratio":       _safe_float(info.get('quickRatio')),
            "debt_to_equity":    _safe_float(info.get('debtToEquity')),
            "interest_coverage": None,   # computed below
            # Dividend
            "dividend_yield":    _normalise_yield(info.get('trailingAnnualDividendYield') or info.get('dividendYield')),
            "payout_ratio":      _safe_float(info.get('payoutRatio')),
            "dividend_per_share":_safe_float(info.get('lastDividendValue')),
            # Growth
            "revenue_growth":    _safe_float(info.get('revenueGrowth')),
            "earnings_growth":   _safe_float(info.get('earningsGrowth')),
            "eps_trailing":      _safe_float(info.get('trailingEps')),
            "eps_forward":       _safe_float(info.get('forwardEps')),
        }
        # Interest coverage from income stmt
        inc_df = _sdf('income_stmt')
        if not inc_df.empty:
            try:
                oi  = _safe_float(inc_df.loc['Operating Income'].iloc[0])  if 'Operating Income'  in inc_df.index else None
                ie  = _safe_float(inc_df.loc['Interest Expense'].iloc[0])  if 'Interest Expense'  in inc_df.index else None
                if oi and ie and abs(ie) > 0:
                    ratios['interest_coverage'] = round(abs(oi / ie), 2)
            except Exception:
                pass

        # ── Capital Structure ─────────────────────────────────────────────────
        cap_structure = {
            "market_cap":            _safe_float(info.get('marketCap')),
            "enterprise_value":      ev,
            "shares_outstanding":    _safe_float(info.get('sharesOutstanding')),
            "float_shares":          _safe_float(info.get('floatShares')),
            "implied_shares":        _safe_float(info.get('impliedSharesOutstanding')),
            "book_value_per_share":  _safe_float(info.get('bookValue')),
            "current_price":         cur,
            "52w_high":              _safe_float(info.get('fiftyTwoWeekHigh')),
            "52w_low":               _safe_float(info.get('fiftyTwoWeekLow')),
            "total_debt":            _safe_float(info.get('totalDebt')),
            "total_cash":            _safe_float(info.get('totalCash')),
            "net_debt":              round((_safe_float(info.get('totalDebt')) or 0)
                                           - (_safe_float(info.get('totalCash')) or 0), 0) or None,
            "beta":                  _safe_float(info.get('beta')),
            "held_pct_insiders":     _safe_float(info.get('heldPercentInsiders')),
            "held_pct_institutions": _safe_float(info.get('heldPercentInstitutions')),
            "short_pct_float":       _safe_float(info.get('shortPercentOfFloat')),
        }

        result = {
            "symbol":   symbol,
            "currency": cy,
            "unit":     unit,
            "profit_loss": {
                "annual":    {"periods": pl_a_per, "rows": pl_a_rows},
                "quarterly": {"periods": pl_q_per, "rows": pl_q_rows},
            },
            "balance_sheet": {
                "periods":     bs_per,
                "assets":      bs_assets,
                "liabilities": bs_liabs,
                "equity":      bs_equity,
            },
            "cash_flows": {
                "annual":    {"periods": cf_a_per, "rows": cf_a_rows},
                "quarterly": {"periods": cf_q_per, "rows": cf_q_rows},
            },
            "ratios":            ratios,
            "capital_structure": cap_structure,
        }
        _cache[cache_key] = {"ts": time.time(), "data": result}
        return result

    except Exception as exc:
        logger.warning("Financials failed for %s: %s", symbol, exc)
        return {"symbol": symbol, "error": str(exc)}


# ── Portfolio holding insights ────────────────────────────────────────────────

def generate_portfolio_insights(holdings: list) -> list:
    """Generate actionable insights for each portfolio holding.

    Reads the cached technical analysis for each holding (no additional
    network calls) and combines it with the holding's P&L to produce
    context-specific actions (``"Stop Loss"``, ``"Book Profit"``,
    ``"Average Down"``, ``"Hold"``, etc.).

    Results are sorted by urgency: ``"high"`` first, then ``"medium"``,
    then ``"low"``.

    Args:
        holdings: List of holding dicts (output of ``calculate_portfolio``),
            each containing ``symbol``, ``pnl_pct``, ``avg_cost``, and
            ``current_price``.

    Returns:
        List of insight dicts with ``action``, ``urgency``, ``price_target``,
        ``stop_loss_suggestion``, ``reasons``, and analysis fields.
    """
    urgency_order = {"high": 0, "medium": 1, "low": 2}
    insights = []

    for h in holdings:
        sym       = h["symbol"]
        pnl_pct   = h.get("pnl_pct")       or 0.0
        avg_cost  = h.get("avg_cost")       or 0.0
        cur_price = h.get("current_price")  or 0.0

        cached   = _cache.get(f"analysis:{sym}")
        analysis = cached["data"] if cached else {}
        tech     = analysis.get("technicals") or {}
        rec      = analysis.get("recommendation") or {}
        rsi      = tech.get("rsi")
        sma200   = tech.get("sma_200")
        wk52hi   = tech.get("week_52_high")
        signal   = rec.get("signal", "Hold")
        score    = rec.get("score", 0)

        # Price target: 52w high if above current, else +15%
        price_target = (
            round(wk52hi, 2) if (wk52hi and wk52hi > cur_price)
            else round(cur_price * 1.15, 2) if cur_price else None
        )
        # Stop loss: 85% of avg cost, or 200 SMA if tighter
        stop_loss = None
        if avg_cost:
            sl_base = round(avg_cost * 0.85, 2)
            if sma200 and sl_base < sma200 < avg_cost:
                stop_loss = round(sma200 * 0.98, 2)
            else:
                stop_loss = sl_base

        action, color, urgency = "Hold", "orange", "low"
        reasons: list = []

        if pnl_pct <= -20:
            if rsi and rsi < 35:
                action, color, urgency = "Average Down", "blue", "medium"
                reasons.append(
                    f"Down {pnl_pct:.1f}% but RSI {rsi:.0f} — oversold; "
                    "average if thesis intact"
                )
            else:
                action, color, urgency = "Stop Loss", "red", "high"
                reasons.append(
                    f"Down {pnl_pct:.1f}% — exit to cap further losses"
                )
        elif pnl_pct <= -10:
            action, color, urgency = "Review", "orange", "medium"
            reasons.append(f"Down {pnl_pct:.1f}% — revisit investment thesis")
            if signal in ("Strong Sell", "Sell"):
                action, color, urgency = "Reduce", "red", "high"
                reasons.append(f"Technicals also bearish ({signal}) — partial exit")
        elif pnl_pct >= 30:
            action, color, urgency = "Book Profit (Partial)", "green", "medium"
            reasons.append(f"Up {pnl_pct:.1f}% — consider booking partial profits")
            if rsi and rsi > 70:
                action, urgency = "Book Profit", "high"
                reasons.append(f"RSI {rsi:.0f} — overbought; momentum may reverse")
        elif pnl_pct >= 15:
            action, color, urgency = "Hold (Trail SL)", "green", "low"
            reasons.append(f"Up {pnl_pct:.1f}% — set trailing stop-loss to protect gains")
        else:
            if signal in ("Strong Buy", "Buy"):
                action, color = "Hold / Add", "green"
                reasons.append(f"Signal: {signal} — consider adding on dips")
            elif signal in ("Strong Sell", "Sell"):
                action, color, urgency = "Reduce", "red", "medium"
                reasons.append(f"Signal: {signal} — reduce exposure")
            else:
                reasons.append("Neutral signal — maintain current position")

        if sma200 and cur_price:
            label = "above" if cur_price > sma200 else "below"
            trend = "uptrend intact" if cur_price > sma200 else "caution: trend weak"
            reasons.append(f"Price {label} 200-day SMA (₹{sma200:.0f}) — {trend}")

        if rsi is not None:
            if rsi < 30:
                reasons.append(f"RSI {rsi:.0f} — strongly oversold; bounce likely")
            elif rsi > 70:
                reasons.append(f"RSI {rsi:.0f} — overbought; wait before adding")

        if score:
            reasons.append(
                f"Technical score: {'+' if score > 0 else ''}{score}"
            )

        insights.append({
            "symbol":              sym,
            "company_name":        h.get("company_name"),
            "pnl_pct":             round(pnl_pct, 2),
            "action":              action,
            "action_color":        color,
            "urgency":             urgency,
            "price_target":        price_target,
            "stop_loss_suggestion":stop_loss,
            "reasons":             reasons,
            "signal":              signal,
            "rsi":                 rsi,
            "sma_200":             sma200,
            "current_price":       cur_price,
            "avg_cost":            avg_cost,
        })

    return sorted(insights, key=lambda x: urgency_order.get(x["urgency"], 2))
