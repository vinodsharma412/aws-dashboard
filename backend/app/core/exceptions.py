"""Pre-built HTTPException instances shared across the application.

Defining exceptions as module-level constants avoids constructing identical
``HTTPException`` objects on every request and keeps error messages consistent.
"""

from fastapi import HTTPException, status

credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)
"""Raised when a JWT is missing, malformed, expired, or belongs to no user."""

invalid_credentials_exception = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Incorrect username or password",
    headers={"WWW-Authenticate": "Bearer"},
)
"""Raised when a login attempt fails due to wrong username or password."""

inactive_user_exception = HTTPException(
    status_code=status.HTTP_400_BAD_REQUEST,
    detail="Inactive user",
)
"""Raised when an authenticated user's account has been deactivated."""

not_found_exception = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Resource not found",
)
"""Generic 404 raised when a requested record does not exist."""
