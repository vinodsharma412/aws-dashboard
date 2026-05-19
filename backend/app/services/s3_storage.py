"""S3-backed file storage — replaces local disk avatar storage.

Provides ``upload_avatar`` and ``delete_avatar`` which work with the
``nse-assets-<account-id>`` S3 bucket instead of the local
``static/avatars/`` directory used in the original project.

The public URL format:
    https://<bucket>.s3.<region>.amazonaws.com/avatars/<filename>

EC2's IAM instance profile (or the configured AWS credentials) must have:
    s3:PutObject, s3:DeleteObject on the bucket ARN.
"""

import uuid
import boto3
from app.config import settings

_s3 = boto3.client("s3", region_name=settings.AWS_REGION)

#: Allowed MIME types for avatar uploads.
ALLOWED_TYPES: frozenset[str] = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/gif"}
)

#: Maximum avatar file size in bytes (3 MB).
MAX_AVATAR_SIZE: int = 3 * 1024 * 1024


def upload_avatar(contents: bytes, content_type: str, user_id: str, ext: str) -> str:
    """Upload avatar bytes to S3 and return the public URL.

    Args:
        contents: Raw file bytes.
        content_type: MIME type (e.g. ``"image/jpeg"``).
        user_id: Used in the S3 key to namespace per user.
        ext: File extension without dot (e.g. ``"jpg"``).

    Returns:
        Public S3 URL string for the uploaded file.
    """
    filename = f"avatars/user_{user_id}_{uuid.uuid4().hex[:8]}.{ext}"
    _s3.put_object(
        Bucket=settings.S3_ASSETS_BUCKET,
        Key=filename,
        Body=contents,
        ContentType=content_type,
    )
    return (
        f"https://{settings.S3_ASSETS_BUCKET}"
        f".s3.{settings.AWS_REGION}.amazonaws.com/{filename}"
    )


def delete_avatar(avatar_url: str) -> None:
    """Delete an avatar from S3 given its full URL.

    Silently ignores errors (e.g. file already deleted).

    Args:
        avatar_url: Full S3 URL returned by ``upload_avatar``.
    """
    if not avatar_url or settings.S3_ASSETS_BUCKET not in avatar_url:
        return
    # Extract S3 key from URL: everything after the bucket host
    key = avatar_url.split(f"{settings.S3_ASSETS_BUCKET}.s3.{settings.AWS_REGION}.amazonaws.com/")[-1]
    try:
        _s3.delete_object(Bucket=settings.S3_ASSETS_BUCKET, Key=key)
    except Exception:
        pass
