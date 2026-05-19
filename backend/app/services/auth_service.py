"""Authentication business logic.

Separates auth logic from the HTTP layer so it can be tested without
a live request context.

In the AWS version, users are fetched from DynamoDB as plain dicts instead of
SQLAlchemy ORM objects.
"""

from app.core.exceptions import inactive_user_exception, invalid_credentials_exception
from app.core.security import create_access_token, verify_password
from app.crud.user_dynamo import get_by_username


def login_user(username: str, password: str) -> str:
    """Validate credentials and return a signed JWT access token.

    Args:
        username: Username submitted in the login form.
        password: Plain-text password submitted in the login form.

    Returns:
        A compact JWT string to be returned as ``access_token`` in the response.

    Raises:
        HTTPException 401: If the username does not exist or the password is wrong.
        HTTPException 400: If the user account is inactive.
    """
    user = get_by_username(username)
    if not user or not verify_password(password, user.get("hashed_password", "")):
        raise invalid_credentials_exception
    if not user.get("is_active", True):
        raise inactive_user_exception
    return create_access_token({"sub": user["username"]})
