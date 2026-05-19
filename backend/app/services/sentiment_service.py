"""News sentiment analysis — Bing/Google RSS + Amazon Comprehend (free tier).

Architecture
------------
1. **News fetching** — Bing News RSS (primary) then Google News RSS (fallback).
   No API keys required; purely public RSS endpoints.

2. **AI scoring** — Amazon Comprehend ``batch_detect_sentiment()`` replaces the
   old keyword-only scorer.  Comprehend uses a pre-trained deep-learning NLP
   model trained on financial and general text.

   Free tier (12 months): 50,000 units/month.
   One unit = 100 characters.  A 500-char headline+summary = 5 units.
   Approximate capacity at free tier: ~1,000 articles/month at 500 chars each.

   Fallback: when Comprehend is disabled (``COMPREHEND_ENABLED=false``) or
   when a throttling/quota error occurs, the service transparently falls back
   to the keyword-based scorer so the app never returns an error to the user.

3. **Caching** — sentiment results are cached in memory for 10 minutes (TTL
   controlled by ``_TTL``).  Article ``og:description`` content is cached for
   24 hours (``_ART_TTL``) because article text is immutable.

Score range: ``-1.0`` (strongly bearish) to ``+1.0`` (strongly bullish).
"""

import logging
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
from typing import List, Optional

import boto3
import httpx
from botocore.exceptions import ClientError

from app.config import settings

logger = logging.getLogger(__name__)

# ── Sentiment keyword sets (fallback scorer) ──────────────────────────────────

_BULLISH: frozenset = frozenset({
    "profit", "growth", "record", "surge", "rally", "strong", "buy",
    "upgrade", "target", "upside", "positive", "earnings beat", "dividend",
    "expansion", "invest", "gain", "robust", "outperform", "deal", "win",
    "breakthrough", "acquisition", "partnership", "order", "contract",
    "recovery", "rebound", "high", "rise", "increase", "improved",
    "bullish", "opportunity", "recommend", "overweight", "beat", "boost",
    "momentum", "green", "advance", "higher", "peak", "approve", "approved",
    "award", "launch", "new high", "all-time",
})

_BEARISH: frozenset = frozenset({
    "loss", "decline", "fall", "concern", "sell", "weak", "cut",
    "downgrade", "risk", "fraud", "penalty", "fine", "lawsuit", "debt",
    "default", "miss", "disappoint", "layoff", "probe", "investigation",
    "warning", "underperform", "bearish", "crash", "drop", "lower",
    "pressure", "worry", "fear", "uncertain", "volatile", "challenge",
    "regulatory", "ban", "halt", "delay", "recession", "slowdown",
    "inflation", "rate hike", "interest rate", "tighten", "negative",
    "withdrawal", "outflow", "sell-off", "correction", "bear", "plunge",
    "slump", "weaken", "disappointing", "missed", "reduced", "worse",
})

_STRONG_BULLISH: frozenset = frozenset({
    "record high", "all-time high", "beats estimate", "strong buy", "outperform",
})
_STRONG_BEARISH: frozenset = frozenset({
    "fraud", "ban", "default", "bankruptcy", "crash", "investigation", "probe",
})

# ── Caches ────────────────────────────────────────────────────────────────────

_CACHE: dict = {}
_TTL: int = 600       # 10-minute sentiment cache

_ART_CACHE: dict = {}
_ART_TTL: int = 86400  # 24-hour article og:description cache

# ── HTTP browser headers ──────────────────────────────────────────────────────

_BROWSER_HEADERS: dict = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

_HEAD_SCAN_CHARS: int = 20_000


# ── Amazon Comprehend scorer ──────────────────────────────────────────────────

_comprehend_client = None


def _get_comprehend():
    """Return a cached Comprehend client (lazy init).

    Returns:
        boto3 Comprehend client, or ``None`` when Comprehend is disabled or
        credentials are unavailable.
    """
    global _comprehend_client
    if _comprehend_client is None and settings.COMPREHEND_ENABLED:
        try:
            _comprehend_client = boto3.client("comprehend", region_name=settings.AWS_REGION)
        except Exception as exc:
            logger.warning("Comprehend client init failed: %s — using keyword fallback", exc)
    return _comprehend_client


def _comprehend_score_batch(texts: List[str]) -> Optional[List[float]]:
    """Score a list of texts using Amazon Comprehend batch_detect_sentiment.

    Splits texts into chunks of 25 (API limit per batch call) and maps
    Comprehend's POSITIVE/NEGATIVE/NEUTRAL/MIXED labels to a ``[-1, +1]``
    float using the confidence scores:

        score = SentimentScore.Positive - SentimentScore.Negative

    Free-tier cost calculation:
        Each text contributes ``ceil(len(text) / 100)`` units.
        Free tier: 50,000 units/month for 12 months.

    Args:
        texts: List of text strings to score (each ≤ 5,000 bytes).

    Returns:
        List of floats in ``[-1.0, +1.0]``, same length as *texts*.
        Returns ``None`` if Comprehend is disabled, unavailable, or hits
        a throttle/quota error — caller should fall back to keyword scoring.
    """
    client = _get_comprehend()
    if not client:
        return None

    scores: List[float] = []
    batch_size = 25  # Comprehend BatchDetectSentiment limit

    try:
        for i in range(0, len(texts), batch_size):
            batch = texts[i: i + batch_size]
            # Truncate each text to 4,900 bytes — Comprehend limit is 5,000
            safe_batch = [t[:4900] for t in batch]
            resp = client.batch_detect_sentiment(
                TextList=safe_batch,
                LanguageCode="en",
            )
            # Build index of results by position
            result_map: dict = {r["Index"]: r for r in resp.get("ResultList", [])}
            for j in range(len(safe_batch)):
                r = result_map.get(j)
                if r:
                    s = r["SentimentScore"]
                    # Positive - Negative gives natural [-1, +1] range
                    scores.append(round(s["Positive"] - s["Negative"], 3))
                else:
                    # Error for this item — fall back to 0 (neutral)
                    scores.append(0.0)

    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code in ("ThrottlingException", "ProvisionedThroughputExceededException",
                    "ServiceUnavailableException", "RequestLimitExceeded"):
            logger.warning("Comprehend quota/throttle: %s — using keyword fallback", code)
        else:
            logger.warning("Comprehend error %s: %s — using keyword fallback", code, exc)
        return None
    except Exception as exc:
        logger.warning("Comprehend unexpected error: %s — using keyword fallback", exc)
        return None

    return scores


# ── Keyword-based fallback scorer ─────────────────────────────────────────────

def _keyword_score(text: str) -> float:
    """Score *text* using keyword matching when Comprehend is unavailable.

    Each ``_BULLISH`` match = +1, ``_BEARISH`` match = -1.
    ``_STRONG_*`` phrases score ±2.  Normalised to ``[-1.0, +1.0]``.

    Args:
        text: Combined headline + summary text.

    Returns:
        Sentiment float in ``[-1.0, +1.0]``, or ``0.0`` if no keywords match.
    """
    low = text.lower()
    bull = sum(1 for w in _BULLISH if w in low)
    bear = sum(1 for w in _BEARISH if w in low)
    bull += sum(2 for w in _STRONG_BULLISH if w in low)
    bear += sum(2 for w in _STRONG_BEARISH if w in low)
    total = bull + bear
    return 0.0 if total == 0 else max(-1.0, min(1.0, (bull - bear) / total))


def _score_articles(articles: List[dict]) -> None:
    """Score article list using Comprehend ML, falling back to keywords.

    Modifies *articles* in place: sets ``score``, ``sentiment``, and
    ``impact`` fields on each item.

    Comprehend is attempted first for the whole batch.  If it fails for any
    reason, keyword scoring is applied to every article individually.

    Args:
        articles: List of article dicts (modified in place).
    """
    if not articles:
        return

    texts = [f"{a.get('title', '')} {a.get('summary', '')}".strip() for a in articles]

    # Try Comprehend batch first (ML-based, free tier)
    comprehend_scores = _comprehend_score_batch(texts)

    for i, article in enumerate(articles):
        if comprehend_scores is not None:
            score = comprehend_scores[i]
        else:
            score = _keyword_score(texts[i])

        article["score"] = score
        article["sentiment"] = "bullish" if score > 0.1 else "bearish" if score < -0.1 else "neutral"
        article["impact"] = "positive" if score > 0.2 else "negative" if score < -0.2 else "neutral"


# ── Text helpers ──────────────────────────────────────────────────────────────

def _clean_text(raw: str) -> str:
    """Decode HTML entities, strip tags, and normalise whitespace.

    Args:
        raw: Raw HTML or plain-text string (may be ``None``).

    Returns:
        Cleaned plain-text string, capped at 400 characters.
    """
    text = unescape(raw or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:400]


def _is_dupe_of_title(summary: str, title: str) -> bool:
    """Return ``True`` when *summary* is essentially a repetition of *title*."""
    s = summary.lower().strip()
    t = title.lower().strip()
    if not s or len(s) < 25:
        return True
    if s.startswith(t[:60]):
        return True
    if t[:50] in s and len(s) < len(t) + 60:
        return True
    return False


def _to_two_sentences(text: str) -> str:
    """Trim *text* to at most two sentences, capped at 280 characters."""
    text = text.strip()
    parts = re.split(r"(?<=[.!?])\s+", text)
    result = " ".join(parts[:2])
    if len(result) > 280:
        result = result[:277].rsplit(" ", 1)[0] + "…"
    return result


def _is_truncated(s: str) -> bool:
    """Return ``True`` when *s* is a truncated snippet (ends in ``…`` or ``...``)."""
    t = s.rstrip() if s else ""
    return not t or t.endswith("…") or t.endswith("...") or len(t) < 60


# ── Article og:description fetcher ───────────────────────────────────────────

def _fetch_og_desc(url: str) -> str:
    """Fetch the ``og:description`` meta tag from an article URL.

    Only reads the first ``_HEAD_SCAN_CHARS`` bytes to avoid downloading
    full article bodies.  Results are cached for ``_ART_TTL`` seconds.

    Args:
        url: Direct article URL (not a Bing/Google redirect).

    Returns:
        Cleaned description string, or ``""`` on failure.
    """
    if not url or "google.com" in url or "bing.com" in url:
        return ""
    entry = _ART_CACHE.get(url)
    if entry is not None and time.time() - entry["ts"] < _ART_TTL:
        return entry["val"]
    val = ""
    try:
        resp = httpx.get(url, timeout=4.0, follow_redirects=True, headers=_BROWSER_HEADERS)
        if resp.status_code == 200:
            head = resp.text[:_HEAD_SCAN_CHARS]
            for pat in (
                r'property=["\']og:description["\'][^>]+content=["\']([^"\']{20,})["\']',
                r'content=["\']([^"\']{20,})["\'][^>]+property=["\']og:description["\']',
                r'name=["\']description["\'][^>]+content=["\']([^"\']{20,})["\']',
                r'content=["\']([^"\']{20,})["\'][^>]+name=["\']description["\']',
            ):
                m = re.search(pat, head, re.IGNORECASE)
                if m:
                    val = _clean_text(m.group(1))
                    break
    except Exception:  # network errors must not bubble up
        pass
    _ART_CACHE[url] = {"ts": time.time(), "val": val}
    return val


def _enrich_summaries(items: List[dict], max_fetch: int = 5) -> None:
    """Replace truncated summaries with og:description content in parallel.

    Fetches up to *max_fetch* article pages concurrently using a
    ThreadPoolExecutor and updates the ``summary`` field in place.

    Args:
        items: List of article dicts (modified in place).
        max_fetch: Maximum number of parallel HTTP fetches.
    """
    need = [it for it in items if it.get("link") and _is_truncated(it.get("summary", ""))]
    if not need:
        return
    targets = need[:max_fetch]
    with ThreadPoolExecutor(max_workers=4) as pool:
        fmap = {pool.submit(_fetch_og_desc, it["link"]): it for it in targets}
        for fut in as_completed(fmap, timeout=6):
            it = fmap[fut]
            try:
                desc = fut.result() or ""
                if desc and not _is_dupe_of_title(desc, it["title"]):
                    it["summary"] = _to_two_sentences(desc)
            except Exception:
                pass


# ── Bing News RSS ─────────────────────────────────────────────────────────────

def _bing_url_to_real(bing_link: str) -> str:
    """Extract the real article URL from a Bing News tracking URL.

    Args:
        bing_link: Raw ``<link>`` from Bing RSS (tracking URL).

    Returns:
        Decoded article URL, or *bing_link* unchanged if extraction fails.
    """
    try:
        params = urllib.parse.parse_qs(urllib.parse.urlparse(bing_link).query)
        return params.get("url", [""])[0] or bing_link
    except Exception:
        return bing_link


def _fetch_bing_rss(query: str, max_items: int = 10) -> List[dict]:
    """Fetch Bing News RSS and return structured article dicts.

    Args:
        query: Search query string (e.g. ``"TCS.NS Tata Consultancy NSE stock"``).
        max_items: Maximum articles to return.

    Returns:
        List of article dicts.  Empty list on network/parse failure.
    """
    items = []
    try:
        url = (
            f"https://www.bing.com/news/search"
            f"?q={urllib.parse.quote_plus(query)}&format=RSS"
        )
        resp = httpx.get(url, timeout=8.0, headers=_BROWSER_HEADERS)
        if resp.status_code != 200:
            return items

        raw_xml = resp.text
        root = ET.fromstring(raw_xml)

        # Bing's namespace URI is query-specific and contains &amp; in raw XML.
        ns_m = re.search(r'xmlns:News="([^"]+)"', raw_xml)
        news_ns = unescape(ns_m.group(1)) if ns_m else ""

        seen: set = set()
        for item in root.findall(".//item"):
            title_el = item.find("title")
            if title_el is None:
                continue
            raw_title = _clean_text(title_el.text or "").strip()
            if not raw_title or raw_title in seen:
                continue
            seen.add(raw_title)

            link_el = item.find("link")
            pub_el = item.find("pubDate")
            desc_el = item.find("description")
            src_el = item.find(f"{{{news_ns}}}Source") if news_ns else None

            raw_link = link_el.text if link_el is not None else None
            real_link = _bing_url_to_real(raw_link) if raw_link else None

            raw_desc = (desc_el.text or "") if desc_el is not None else ""
            summary = _clean_text(raw_desc)
            if _is_dupe_of_title(summary, raw_title):
                summary = ""
            elif summary and not _is_truncated(summary):
                summary = _to_two_sentences(summary)

            source = ""
            if src_el is not None and src_el.text:
                source = src_el.text.strip()
            if not source:
                m = re.search(r"\s[-–]\s([^-–]{4,40})$", raw_title)
                if m:
                    source = m.group(1).strip()

            m2 = re.search(r"\s[-–]\s[^-–]{4,40}$", raw_title)
            clean_title = raw_title[: m2.start()].strip() if m2 else raw_title

            # Score is set to 0.0 here; _score_articles() fills in real values
            items.append({
                "title": clean_title or raw_title,
                "source": source,
                "summary": summary,
                "link": real_link,
                "published": pub_el.text if pub_el is not None else None,
                "score": 0.0,
                "sentiment": "neutral",
                "impact": "neutral",
                "scope": "domestic",
            })
            if len(items) >= max_items:
                break
    except Exception as exc:
        logger.debug("Bing RSS fetch failed: %s", exc)
    return items


# ── Google News RSS (fallback) ────────────────────────────────────────────────

def _fetch_google_rss(url: str, max_items: int = 8) -> List[dict]:
    """Fetch Google News RSS and return article dicts.

    Used when Bing returns fewer than 4 results.

    Args:
        url: Full Google News RSS URL (including query params).
        max_items: Maximum articles to return.

    Returns:
        List of article dicts.  Empty list on failure.
    """
    items = []
    try:
        resp = httpx.get(url, timeout=10.0, headers=_BROWSER_HEADERS)
        if resp.status_code != 200:
            return items
        root = ET.fromstring(resp.text)
        seen: set = set()

        for item in root.findall(".//item"):
            title_el = item.find("title")
            if title_el is None:
                continue
            raw_title = _clean_text(title_el.text or "").strip()
            if not raw_title or raw_title in seen:
                continue
            seen.add(raw_title)

            link_el = item.find("link")
            pub_el = item.find("pubDate")
            desc_el = item.find("description")
            src_el = item.find("source")

            raw_desc = _clean_text(desc_el.text) if (desc_el is not None and desc_el.text) else ""
            raw_desc = re.sub(r"\s*[-–]\s*[A-Z][A-Za-z .]{3,40}$", "", raw_desc).strip()
            summary = "" if _is_dupe_of_title(raw_desc, raw_title) else _to_two_sentences(raw_desc)

            source = ""
            if src_el is not None and src_el.text:
                source = src_el.text.strip()
            if not source:
                m = re.search(r"\s[-–]\s([^-–]{4,40})$", raw_title)
                if m:
                    source = m.group(1).strip()

            m2 = re.search(r"\s[-–]\s[^-–]{4,40}$", raw_title)
            clean_title = raw_title[: m2.start()].strip() if m2 else raw_title

            items.append({
                "title": clean_title or raw_title,
                "source": source,
                "summary": summary,
                "link": link_el.text if link_el is not None else None,
                "published": pub_el.text if pub_el is not None else None,
                "score": 0.0,
                "sentiment": "neutral",
                "impact": "neutral",
                "scope": "domestic",
            })
            if len(items) >= max_items:
                break
    except Exception as exc:
        logger.debug("Google RSS fetch failed for %s: %s", url, exc)
    return items


# ── News category fetchers ────────────────────────────────────────────────────

def _fetch_domestic_news(company: str, symbol_base: str) -> List[dict]:
    """Fetch NSE stock-specific domestic news via Bing, with Google fallback.

    After fetching raw articles, calls ``_enrich_summaries`` to expand
    truncated summaries from article og:description tags.

    Args:
        company: Company name (e.g. ``"Tata Consultancy Services"``).
        symbol_base: Ticker without exchange suffix (e.g. ``"TCS"``).

    Returns:
        List of up to 10 article dicts with ``scope="domestic"``.
    """
    q = f"{symbol_base} {company} NSE stock India"
    items = _fetch_bing_rss(q, max_items=10)

    if len(items) < 4:
        gurl = (
            f"https://news.google.com/rss/search"
            f"?q={symbol_base.replace(' ', '+')}&hl=en-IN&gl=IN&ceid=IN:en"
        )
        items = _fetch_google_rss(gurl, max_items=10)

    for it in items:
        it["scope"] = "domestic"
    _enrich_summaries(items, max_fetch=5)
    return items


def _fetch_international_news(company: str, sector: str) -> List[dict]:
    """Fetch international and macro news for *company* / *sector*.

    Args:
        company: Company name for the primary query.
        sector: Sector name for the secondary macro query.

    Returns:
        List of up to 6 article dicts with ``scope="international"``.
    """
    results = []
    for q in [f"{company} global stock market", f"{sector} sector global outlook FII"]:
        items = _fetch_bing_rss(q, max_items=4)
        if not items:
            gurl = (
                f"https://news.google.com/rss/search"
                f"?q={q.replace(' ', '+')}&hl=en&gl=US&ceid=US:en"
            )
            items = _fetch_google_rss(gurl, max_items=4)
        for it in items:
            it["scope"] = "international"
        results.extend(items)
    _enrich_summaries(results, max_fetch=3)
    return results[:6]


def _fetch_macro_news() -> List[dict]:
    """Fetch RBI / monetary policy macro news relevant to all NSE stocks.

    Returns:
        List of up to 4 article dicts with ``scope="macro"``.
    """
    q = "RBI monetary policy India interest rate market"
    items = _fetch_bing_rss(q, max_items=4)
    if not items:
        gurl = (
            f"https://news.google.com/rss/search"
            f"?q={q.replace(' ', '+')}&hl=en-IN&gl=IN&ceid=IN:en"
        )
        items = _fetch_google_rss(gurl, max_items=4)
    for it in items:
        it["scope"] = "macro"
    return items[:4]


# ── Main entry point ──────────────────────────────────────────────────────────

def analyze_sentiment(
    symbol: str, company_name: str = "", sector: str = ""
) -> dict:
    """Return a comprehensive sentiment analysis for *symbol*.

    Flow:
    1. Check in-memory cache (TTL = 10 min).
    2. Fetch domestic, international, and macro news from RSS feeds.
    3. Enrich truncated summaries from article og:description pages.
    4. Score all articles using Amazon Comprehend (ML, free tier).
       Falls back to keyword scoring on any Comprehend error.
    5. Compute composite score and cache the result.

    Scoring model:
        Amazon Comprehend ``batch_detect_sentiment`` returns per-class
        confidence scores.  The final score is:
            ``SentimentScore.Positive - SentimentScore.Negative``
        giving a natural range of ``-1.0`` to ``+1.0``.

    Args:
        symbol: Yahoo Finance ticker (e.g. ``"TCS.NS"``).
        company_name: Full company name for the Bing query.
            Defaults to the ticker base (e.g. ``"TCS"``).
        sector: Sector name for international news queries.

    Returns:
        Dict with keys:
        - ``symbol``: Input ticker.
        - ``score``: Composite float in ``[-1.0, +1.0]``.
        - ``label``: ``"Bullish"``, ``"Neutral"``, or ``"Bearish"``.
        - ``confidence``: ``"Strong"``, ``"Moderate"``, or ``"Weak"``.
        - ``scored_by``: ``"comprehend"`` or ``"keywords"`` (for observability).
        - ``headlines``: Up to 10 domestic article dicts.
        - ``intl_news``: Up to 6 international article dicts.
        - ``macro_news``: Up to 4 macro article dicts.
        - ``counts``: ``{"bullish": n, "bearish": n, "neutral": n}``.
    """
    cache_key = f"sentiment:{symbol}"
    entry = _CACHE.get(cache_key)
    if entry and time.time() - entry["ts"] < _TTL:
        return entry["data"]

    symbol_base = symbol.replace(".NS", "").replace(".BO", "")
    company = company_name or symbol_base
    sec = sector or ""

    domestic = _fetch_domestic_news(company, symbol_base)
    intl = _fetch_international_news(company, sec)
    macro = _fetch_macro_news()

    # Score articles — tries Comprehend first, falls back to keywords
    all_articles = domestic + intl + macro
    _score_articles(all_articles)

    # Determine which scoring method was actually used
    scored_by = "comprehend" if (settings.COMPREHEND_ENABLED and _get_comprehend()) else "keywords"

    dom_scores = [h["score"] for h in domestic]

    if not dom_scores:
        result = {
            "symbol": symbol,
            "score": 0.0,
            "label": "Neutral",
            "confidence": "Weak",
            "scored_by": scored_by,
            "headlines": [],
            "intl_news": intl,
            "macro_news": macro,
            "counts": {"bullish": 0, "bearish": 0, "neutral": 0},
        }
        _CACHE[cache_key] = {"ts": time.time(), "data": result}
        return result

    avg = sum(dom_scores) / len(dom_scores)
    bull_n = sum(1 for s in dom_scores if s > 0.1)
    bear_n = sum(1 for s in dom_scores if s < -0.1)
    neut_n = len(dom_scores) - bull_n - bear_n

    label = "Bullish" if avg > 0.2 else "Bearish" if avg < -0.2 else "Neutral"
    dom_max = max(bull_n, bear_n, neut_n)
    conf = (
        "Strong" if dom_max >= len(dom_scores) * 0.65
        else "Moderate" if dom_max >= len(dom_scores) * 0.40
        else "Weak"
    )

    result = {
        "symbol": symbol,
        "score": round(avg, 3),
        "label": label,
        "confidence": conf,
        "scored_by": scored_by,
        "headlines": domestic[:10],
        "intl_news": intl,
        "macro_news": macro,
        "counts": {"bullish": bull_n, "bearish": bear_n, "neutral": neut_n},
    }
    _CACHE[cache_key] = {"ts": time.time(), "data": result}
    return result
