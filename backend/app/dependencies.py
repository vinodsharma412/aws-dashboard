"""FastAPI dependency graph for authentication.

Provides two chained dependencies:

* ``get_current_user`` — decodes the JWT and fetches the matching user from DynamoDB.
* ``get_current_active_user`` — additionally asserts the account is active.

In the AWS version users are plain dicts (DynamoDB items) rather than ORM objects.
All downstream consumers use dict key access: ``user["username"]``, ``user["role"]``.
"""

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError

from app.core.exceptions import credentials_exception
from app.core.security import decode_token
from app.crud.user_dynamo import get_by_username

#: Tells FastAPI where the client can obtain a token (shown in OpenAPI docs).
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token")


def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """Decode the Bearer JWT and return the corresponding user dict from DynamoDB.

    Args:
        token: JWT extracted from the ``Authorization: Bearer <token>`` header.

    Returns:
        The DynamoDB user item (dict) whose username matches the ``sub`` claim.

    Raises:
        HTTPException 401: If the token is invalid, expired, missing the
            ``sub`` claim, or the username has no matching row in DynamoDB.
    """
    try:
        payload = decode_token(token)
        username: str = payload.get("sub")
        if not username:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = get_by_username(username)
    if not user:
        raise credentials_exception
    return user


def get_current_active_user(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Assert the authenticated user's account is active.

    Args:
        current_user: Authenticated user dict resolved by ``get_current_user``.

    Returns:
        The same user dict, confirmed active.

    Raises:
        HTTPException 401: If ``user["is_active"]`` is ``False``.
    """
    if not current_user.get("is_active", True):
        raise credentials_exception
    return current_user
