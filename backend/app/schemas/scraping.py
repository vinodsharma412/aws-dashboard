"""Pydantic schemas for scraping job/task request and response bodies.

Note: In the AWS version all primary keys are UUID strings (not int).
Timestamps are ISO-8601 strings from DynamoDB (not datetime objects).
"""

import re
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, field_validator

#: Maximum ASINs allowed in a single job.
_MAX_ASINS = 50


class JobCreate(BaseModel):
    """Request body for ``POST /scraping/jobs``."""

    asins: List[str]

    @field_validator("asins")
    @classmethod
    def validate_asins(cls, v: List[str]) -> List[str]:
        """Strip whitespace, upper-case, and reject non-ASIN strings.

        Args:
            v: Raw list of strings from the request body.

        Returns:
            Cleaned list of valid 10-character alphanumeric ASIN strings.

        Raises:
            ValueError: If no valid ASINs remain or list exceeds ``_MAX_ASINS``.
        """
        cleaned = [
            asin
            for raw in v
            if re.match(r"^[A-Z0-9]{10}$", asin := raw.strip().upper())
        ]
        if not cleaned:
            raise ValueError(
                "No valid ASINs provided (each must be 10 alphanumeric characters)."
            )
        if len(cleaned) > _MAX_ASINS:
            raise ValueError(f"Maximum {_MAX_ASINS} ASINs per request.")
        return cleaned


class ProductDataOut(BaseModel):
    """Scraped Amazon product data."""

    asin: str
    title: Optional[str] = None
    brand: Optional[str] = None
    price: Optional[str] = None
    rating: Optional[str] = None
    review_count: Optional[str] = None
    availability: Optional[str] = None
    image_url: Optional[str] = None
    scraped_at: Optional[str] = None


class TaskOut(BaseModel):
    """Single ASIN scraping task status."""

    id: str                          # UUID string (DynamoDB PK)
    asin: str
    status: str                      # pending | running | completed | failed
    error: Optional[str] = None
    queued_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    product: Optional[ProductDataOut] = None


class JobOut(BaseModel):
    """Scraping job summary, optionally including its task list."""

    id: str                          # UUID string (DynamoDB PK)
    user_id: str                     # UUID string of the owning user
    username: Optional[str] = None
    total: int
    pending: int
    running: int
    completed: int
    failed: int
    created_at: Optional[str] = None
    tasks: Optional[List[TaskOut]] = None
