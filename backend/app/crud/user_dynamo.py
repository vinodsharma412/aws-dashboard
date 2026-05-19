"""User CRUD operations against DynamoDB.

Replaces ``crud/user.py`` (SQLAlchemy) from the original project.
All methods return plain dicts (DynamoDB items) rather than ORM objects.

DynamoDB access pattern:
    get_by_username  →  username-index GSI query
    get_by_id        →  primary key GetItem
    create           →  PutItem
    update           →  UpdateItem (partial fields)
    delete           →  DeleteItem
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from boto3.dynamodb.conditions import Key

from app.core.security import hash_password
from app.db.dynamo import dynamo_users


def get_by_username(username: str) -> Optional[dict]:
    """Look up a user by username using the GSI.

    Args:
        username: Exact username string.

    Returns:
        User dict or ``None`` if not found.
    """
    resp = dynamo_users.query(
        IndexName="username-index",
        KeyConditionExpression=Key("username").eq(username),
        Limit=1,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def get_by_email(email: str) -> Optional[dict]:
    """Look up a user by email using the GSI.

    Args:
        email: Exact email string.

    Returns:
        User dict or ``None`` if not found.
    """
    resp = dynamo_users.query(
        IndexName="email-index",
        KeyConditionExpression=Key("email").eq(email),
        Limit=1,
    )
    items = resp.get("Items", [])
    return items[0] if items else None


def get_by_id(user_id: str) -> Optional[dict]:
    """Fetch a user by primary key.

    Args:
        user_id: UUID string primary key.

    Returns:
        User dict or ``None``.
    """
    resp = dynamo_users.get_item(Key={"user_id": user_id})
    return resp.get("Item")


def get_all(skip: int = 0, limit: int = 100) -> list[dict]:
    """Scan all users (admin list endpoint).

    DynamoDB Scan is used because there is no sort-key for listing all users.
    For large tables, implement pagination with ``ExclusiveStartKey``.

    Args:
        skip: Number of items to skip (client-side).
        limit: Maximum items to return.

    Returns:
        List of user dicts.
    """
    resp = dynamo_users.scan(Limit=limit + skip)
    return resp.get("Items", [])[skip: skip + limit]


def create(username: str, email: str, full_name: str, role: str, password: str) -> dict:
    """Create a new user and store in DynamoDB.

    Args:
        username: Unique username.
        email: Unique email address.
        full_name: Display name.
        role: One of ``"admin"``, ``"manager"``, ``"viewer"``.
        password: Plain-text password (hashed before storage).

    Returns:
        The newly created user dict.
    """
    user = {
        "user_id": str(uuid.uuid4()),
        "username": username,
        "email": email,
        "full_name": full_name,
        "role": role,
        "hashed_password": hash_password(password),
        "is_active": True,
        "avatar_url": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    dynamo_users.put_item(Item=user)
    return user


def update(user_id: str, fields: dict) -> Optional[dict]:
    """Partially update a user — only supplied fields are changed.

    If ``"password"`` is in *fields*, it is hashed before storage.

    Args:
        user_id: Primary key of the user to update.
        fields: Dict of fields to update (e.g. ``{"full_name": "New Name"}``).

    Returns:
        Updated user dict, or ``None`` if not found.
    """
    if not get_by_id(user_id):
        return None

    if "password" in fields:
        fields["hashed_password"] = hash_password(fields.pop("password"))

    update_expr = "SET " + ", ".join(f"#{k} = :{k}" for k in fields)
    expr_names  = {f"#{k}": k for k in fields}
    expr_values = {f":{k}": v for k, v in fields.items()}

    resp = dynamo_users.update_item(
        Key={"user_id": user_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp.get("Attributes")


def delete(user_id: str) -> None:
    """Delete a user by primary key.

    Args:
        user_id: UUID string primary key.
    """
    dynamo_users.delete_item(Key={"user_id": user_id})
