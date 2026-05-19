"""Application configuration — multi-stage AWS edition.

Stage-aware configuration that supports three deployment environments:
``dev``, ``qc``, and ``prod``.  Each stage gets its own:

- DynamoDB table prefix  (empty for prod; ``dev_`` / ``qc_`` otherwise)
- SQS queue names        (``nse-scraping-jobs-{stage}``)
- SSM parameter paths    (``/nse/{stage}/…``)

Secrets are stored in **AWS SSM Parameter Store** (SecureString — free tier)
and loaded at startup.  For local development the same values can be placed
in ``backend/.env`` and the SSM fetch is skipped automatically.

Free-tier note
--------------
SSM Parameter Store SecureString uses the AWS-managed KMS key at no extra
charge — unlike Secrets Manager ($0.40/secret/month).  This keeps the entire
stack within the AWS Free Tier for exploration and development.

Environment variables (can override any setting):
    STAGE                  dev | qc | prod  (default: dev)
    SECRET_KEY             JWT signing key (loaded from SSM when empty)
    AWS_REGION             ap-south-1 (default)
    S3_ASSETS_BUCKET       nse-assets-<account-id>
    SQS_SCRAPING_JOBS_URL  full SQS queue URL (loaded from SSM when empty)
    SNS_ALERTS_ARN         arn:aws:sns:…    (loaded from SSM when empty)
    COMPREHEND_ENABLED     true | false     (default: true)
    GMAIL_USER             SMTP sender      (loaded from SSM when empty)
    GMAIL_APP_PASSWORD     SMTP password    (loaded from SSM when empty)
"""

import logging
from functools import lru_cache
from typing import Optional

import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


# ── SSM helper ────────────────────────────────────────────────────────────────

def _ssm_get(path: str, region: str = "ap-south-1") -> Optional[str]:
    """Read a SecureString parameter from SSM Parameter Store.

    Gracefully returns ``None`` when the parameter is absent, when AWS
    credentials are not available (local dev without a profile), or on any
    other error.  This lets the app start normally from ``.env`` values.

    Args:
        path: Full SSM parameter path, e.g. ``/nse/prod/jwt-secret``.
        region: AWS region hosting the SSM endpoint.

    Returns:
        Decrypted string value, or ``None`` on any failure.
    """
    try:
        client = boto3.client("ssm", region_name=region)
        resp = client.get_parameter(Name=path, WithDecryption=True)
        return resp["Parameter"]["Value"]
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code not in ("ParameterNotFound", "ParameterVersionNotFound"):
            logger.debug("SSM fetch failed for %s: %s", path, code)
    except NoCredentialsError:
        logger.debug("No AWS credentials — skipping SSM fetch for %s", path)
    except Exception as exc:
        logger.debug("SSM unexpected error for %s: %s", path, exc)
    return None


# ── Settings ──────────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    """All application settings loaded from environment variables or .env file.

    Sensitive values (SECRET_KEY, GMAIL_APP_PASSWORD) are resolved from SSM
    Parameter Store when the corresponding env var is empty.  The SSM fetch
    happens once at startup via :func:`get_settings`.
    """

    # ── Deployment stage ──────────────────────────────────────────────────────
    STAGE: str = "dev"
    """Deployment stage.  Controls DynamoDB table prefix, SQS queue names,
    and SSM parameter paths.  Valid values: ``dev``, ``qc``, ``prod``."""

    APP_NAME: str = "NSE Stock Dashboard"
    APP_ENV: str = "development"
    DEBUG: bool = True

    # ── Authentication ────────────────────────────────────────────────────────
    SECRET_KEY: str = ""
    """JWT signing key.  Loaded from SSM ``/nse/{stage}/jwt-secret`` when empty."""

    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours

    # ── AWS core ──────────────────────────────────────────────────────────────
    AWS_REGION: str = "ap-south-1"
    AWS_ACCOUNT_ID: str = ""
    S3_ASSETS_BUCKET: str = ""
    """S3 bucket for user avatars and file uploads."""

    # ── Amazon SQS (scraping job queue) ──────────────────────────────────────
    SQS_SCRAPING_JOBS_URL: str = ""
    """Full SQS queue URL.  Loaded from SSM ``/nse/{stage}/sqs-jobs-url``."""

    # ── Amazon SNS (operational alerts) ──────────────────────────────────────
    SNS_ALERTS_ARN: str = ""
    """SNS topic ARN for failure/ops alerts.  Loaded from SSM."""

    # ── Amazon Comprehend (free-tier AI sentiment) ─────────────────────────
    COMPREHEND_ENABLED: bool = True
    """Enable Amazon Comprehend ML sentiment scoring (free tier: 50k units/month).
    When ``False``, falls back to keyword-only scoring — no AWS calls needed."""

    # ── Email / SMTP ─────────────────────────────────────────────────────────
    GMAIL_USER: str = ""
    """Gmail sender address.  Loaded from SSM ``/nse/{stage}/gmail-user``."""

    GMAIL_APP_PASSWORD: str = ""
    """Gmail app password.  Loaded from SSM ``/nse/{stage}/gmail-password``."""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    # ── Derived properties (no extra env vars needed) ─────────────────────────

    @property
    def table_prefix(self) -> str:
        """DynamoDB table name prefix for the current stage.

        ``prod`` uses tables as-is (backward-compatible).
        Lower environments prefix all table names so they never touch
        production data even when pointing at the same AWS account.

        Examples::

            prod → ""       →  table name: "users"
            qc   → "qc_"   →  table name: "qc_users"
            dev  → "dev_"  →  table name: "dev_users"
        """
        return "" if self.STAGE == "prod" else f"{self.STAGE}_"

    @property
    def is_production(self) -> bool:
        """``True`` only when running in the ``prod`` stage."""
        return self.STAGE == "prod"


# ── Factory: load settings once and enrich from SSM ──────────────────────────

@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Load settings from env/.env, then enrich empty secrets from SSM.

    Decorated with ``@lru_cache`` so SSM is queried at most once per process.
    Call ``get_settings.cache_clear()`` in tests to force a reload.

    Returns:
        Fully populated :class:`Settings` instance.
    """
    s = Settings()
    region = s.AWS_REGION
    stage = s.STAGE

    def _ssm(key: str) -> Optional[str]:
        return _ssm_get(f"/nse/{stage}/{key}", region)

    # Build a patch dict — only overwrite fields that are still empty
    patch: dict = {}
    if not s.SECRET_KEY:
        patch["SECRET_KEY"] = _ssm("jwt-secret") or ""
    if not s.GMAIL_USER:
        patch["GMAIL_USER"] = _ssm("gmail-user") or ""
    if not s.GMAIL_APP_PASSWORD:
        patch["GMAIL_APP_PASSWORD"] = _ssm("gmail-password") or ""
    if not s.SQS_SCRAPING_JOBS_URL:
        patch["SQS_SCRAPING_JOBS_URL"] = _ssm("sqs-jobs-url") or ""
    if not s.SNS_ALERTS_ARN:
        patch["SNS_ALERTS_ARN"] = _ssm("sns-alerts-arn") or ""
    if not s.S3_ASSETS_BUCKET:
        patch["S3_ASSETS_BUCKET"] = _ssm("s3-assets-bucket") or ""

    non_empty_patch = {k: v for k, v in patch.items() if v}
    if non_empty_patch:
        merged = {**s.model_dump(), **non_empty_patch}
        return Settings.model_validate(merged)

    return s


# ── Module-level singleton ────────────────────────────────────────────────────

settings: Settings = get_settings()
"""Global settings singleton.  Import with ``from app.config import settings``."""
