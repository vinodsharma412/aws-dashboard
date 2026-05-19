"""Password hashing and JWT token utilities.

Centralises all cryptographic operations so no other module touches
jwt or passlib directly.
"""

from datetime import datetime, timedelta

from jose import jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Return a bcrypt hash of *password*.

    Args:
        password: Plain-text password supplied by the user.

    Returns:
        A bcrypt hash string (includes salt and work-factor metadata).
    """
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Check whether *plain* matches the stored *hashed* password.

    Args:
        plain: Plain-text password from the login request.
        hashed: bcrypt hash retrieved from DynamoDB.

    Returns:
        ``True`` if the password matches, ``False`` otherwise.
    """
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    """Create a signed JWT access token.

    Adds an ``exp`` claim using ``ACCESS_TOKEN_EXPIRE_MINUTES`` from settings.

    Args:
        data: Payload dict (must include ``"sub"`` with the username).

    Returns:
        A compact URL-safe JWT string signed with the application secret key.
    """
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict:
    """Decode and verify a JWT token.

    Args:
        token: Compact JWT string from the ``Authorization: Bearer`` header.

    Returns:
        The decoded payload dict (e.g. ``{"sub": "alice", "exp": ...}``).

    Raises:
        jose.JWTError: If the signature is invalid or the token has expired.
    """
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
