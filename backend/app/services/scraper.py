"""Amazon.in product scraper using Playwright headless Chrome.

``scrape_amazon_asin`` is the single public function.  It navigates to the
Amazon product page, detects CAPTCHAs, and extracts title, brand, price,
rating, review count, availability, and the hero image URL.

Price selectors are listed in priority order in ``_PRICE_SELECTORS``.  Amazon
periodically rearranges its DOM, so multiple fallbacks are necessary.
"""

import logging
from datetime import datetime
from typing import Any, Optional

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

logger = logging.getLogger(__name__)

#: Browser identity sent to Amazon to reduce bot-detection triggers.
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

#: CSS selectors tried in order to locate the product price.
#: Amazon's DOM structure varies by product type and A/B test cohort.
_PRICE_SELECTORS: list[str] = [
    ".a-price .a-offscreen",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    ".apexPriceToPay .a-offscreen",
    "#corePrice_feature_div .a-offscreen",
]

#: Maximum time (ms) to wait for a page load or element to appear.
_PAGE_TIMEOUT_MS = 30_000

#: Time (ms) to wait for the product title element before proceeding with
#: whatever partial data is already available.
_TITLE_WAIT_MS = 10_000


# ── Private DOM helpers ────────────────────────────────────────────────────────


def _text(page: Any, selector: str) -> Optional[str]:
    """Return the trimmed inner text of the first element matching *selector*.

    Args:
        page: A Playwright ``Page`` object.
        selector: CSS selector string.

    Returns:
        The stripped text content, or ``None`` if the element is absent or
        raises an exception.
    """
    try:
        el = page.query_selector(selector)
        return el.inner_text().strip() if el else None
    except Exception:
        return None


def _attr(page: Any, selector: str, attr: str) -> Optional[str]:
    """Return the value of *attr* on the first element matching *selector*.

    Args:
        page: A Playwright ``Page`` object.
        selector: CSS selector string.
        attr: HTML attribute name (e.g. ``"src"``, ``"data-old-hires"``).

    Returns:
        The attribute value string, or ``None`` if missing or on error.
    """
    try:
        el = page.query_selector(selector)
        return el.get_attribute(attr) if el else None
    except Exception:
        return None


# ── Public API ─────────────────────────────────────────────────────────────────


def scrape_amazon_asin(asin: str) -> dict:
    """Scrape product data for one Amazon ASIN from amazon.in.

    Opens a headless Chromium browser with an Indian locale, navigates to the
    product page, and extracts structured product data.  The browser is always
    closed in the ``finally`` block to prevent resource leaks.

    Args:
        asin: Amazon Standard Identification Number (10-character string,
            e.g. ``"B09G9HD6PD"``).

    Returns:
        A dict with keys:
        ``asin``, ``title``, ``brand``, ``price``, ``rating``,
        ``review_count``, ``availability``, ``image_url``, ``scraped_at``.
        Fields that could not be extracted are ``None``.

    Raises:
        RuntimeError: If Amazon serves a CAPTCHA page or returns a 404.
    """
    url = f"https://www.amazon.in/dp/{asin}"
    result: dict = {
        "asin": asin,
        "title": None,
        "brand": None,
        "price": None,
        "rating": None,
        "review_count": None,
        "availability": None,
        "image_url": None,
        "scraped_at": datetime.utcnow(),
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            executable_path="/usr/bin/chromium-browser",
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            context = browser.new_context(
                user_agent=_USER_AGENT,
                viewport={"width": 1280, "height": 900},
                locale="en-IN",
                extra_http_headers={"Accept-Language": "en-IN,en;q=0.9"},
            )
            page = context.new_page()
            page.set_default_timeout(_PAGE_TIMEOUT_MS)

            resp = page.goto(url, wait_until="domcontentloaded", timeout=_PAGE_TIMEOUT_MS)

            # Detect CAPTCHA / robot-check page before extracting anything.
            if (
                page.query_selector("form[action='/errors/validateCaptcha']")
                or "captcha" in page.url.lower()
                or "robot" in (page.title() or "").lower()
            ):
                raise RuntimeError(f"Amazon returned CAPTCHA for ASIN {asin}")

            if resp and resp.status == 404:
                raise RuntimeError(f"ASIN {asin} not found on Amazon.in (404)")

            # Wait for the title element; proceed with partial data on timeout.
            try:
                page.wait_for_selector("#productTitle", timeout=_TITLE_WAIT_MS)
            except PWTimeout:
                pass

            # --- Extract fields ---
            result["title"] = _text(page, "#productTitle")

            # Price: try selectors in priority order, stop at first match.
            for sel in _PRICE_SELECTORS:
                val = _text(page, sel)
                if val:
                    result["price"] = val
                    break

            # Rating is stored in the ``title`` attribute of the popover element.
            try:
                el = page.query_selector("#acrPopover")
                if el:
                    title_attr = el.get_attribute("title") or ""
                    result["rating"] = title_attr.split(" ")[0] if title_attr else None
            except Exception:
                pass

            result["review_count"] = _text(page, "#acrCustomerReviewText")

            avail = _text(page, "#availability span")
            result["availability"] = avail.strip() if avail else None

            result["brand"] = _text(page, "#bylineInfo")

            # Hero image: prefer high-res ``data-old-hires``, fall back to ``src``.
            img_el = page.query_selector("#landingImage")
            if img_el:
                result["image_url"] = img_el.get_attribute(
                    "data-old-hires"
                ) or img_el.get_attribute("src")

            logger.info("Scraped ASIN %s: title=%r", asin, result["title"])
        finally:
            browser.close()

    return result
