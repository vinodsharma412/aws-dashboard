"""Pydantic schemas for user request/response bodies.

Note: In the AWS version the primary key is ``user_id`` (UUID string),
not an integer ``id``. ``UserResponse`` reflects the DynamoDB item structure.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class UserBase(BaseModel):
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: str = "viewer"


class UserCreate(UserBase):
    password: str


class UserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class UserResponse(BaseModel):
    """Serialised user returned to API consumers.

    Uses ``user_id`` (UUID string) as the identifier because DynamoDB items
    do not have auto-increment integer PKs.
    """

    user_id: str
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: str
    is_active: bool
    avatar_url: Optional[str] = None
    created_at: Optional[str] = None

    model_config = {"from_attributes": True}
