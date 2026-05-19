"""User management endpoints.

Covers the authenticated user's own profile (``/me``), admin-level CRUD for
all users, and avatar image upload/removal.

Key differences from the PostgreSQL version:
- Users are plain dicts from DynamoDB, not ORM objects.
- Primary key is ``user_id`` (UUID string), not an integer ``id``.
- Avatar images are stored in S3, not on local disk.

Role requirements:
    - ``GET /me`` — any authenticated user
    - ``GET /`` — ADMIN or MANAGER
    - ``POST /``, ``PUT /{user_id}``, ``DELETE /{user_id}`` — ADMIN only
    - ``POST /me/avatar``, ``DELETE /me/avatar`` — any authenticated user
"""

from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.core.roles import Role, require_roles
from app.crud import user_dynamo
from app.dependencies import get_current_active_user
from app.schemas.user import UserCreate, UserResponse, UserUpdate
from app.services.s3_storage import delete_avatar, upload_avatar

#: MIME types accepted for avatar uploads.
ALLOWED_TYPES: frozenset[str] = frozenset(
    {"image/jpeg", "image/png", "image/webp", "image/gif"}
)

#: Maximum avatar file size in bytes (3 MB).
MAX_AVATAR_SIZE: int = 3 * 1024 * 1024

router = APIRouter()


@router.get("/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(get_current_active_user)) -> dict:
    """Return the profile of the currently authenticated user.

    Args:
        current_user: Authenticated user dict from DynamoDB.

    Returns:
        User dict serialised as ``UserResponse``.
    """
    return current_user


@router.get("/", response_model=List[UserResponse])
def list_users(
    skip: int = 0,
    limit: int = 100,
    _: dict = Depends(require_roles(Role.ADMIN, Role.MANAGER)),
) -> List[dict]:
    """Return a paginated list of all users (DynamoDB Scan).

    Args:
        skip: Number of items to skip (client-side offset).
        limit: Maximum number of items to return.
        _: Role guard — ADMIN or MANAGER only.

    Returns:
        A list of user dicts serialised as ``UserResponse``.
    """
    return user_dynamo.get_all(skip=skip, limit=limit)


@router.post("/", response_model=UserResponse)
def create_user(
    user_in: UserCreate,
    _: dict = Depends(require_roles(Role.ADMIN)),
) -> dict:
    """Create a new user account in DynamoDB.

    Args:
        user_in: Validated ``UserCreate`` payload (includes plain-text password).
        _: Role guard — ADMIN only.

    Returns:
        The newly created user dict.

    Raises:
        HTTPException 400: If the username is already taken.
    """
    existing = user_dynamo.get_by_username(user_in.username)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists",
        )
    return user_dynamo.create(
        username=user_in.username,
        email=user_in.email or "",
        full_name=user_in.full_name or "",
        role=user_in.role,
        password=user_in.password,
    )


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: str,
    user_in: UserUpdate,
    _: dict = Depends(require_roles(Role.ADMIN)),
) -> dict:
    """Partially update a user's profile fields in DynamoDB.

    Only fields included in *user_in* are changed.

    Args:
        user_id: UUID string primary key of the user to update.
        user_in: ``UserUpdate`` schema with the fields to change.
        _: Role guard — ADMIN only.

    Returns:
        The updated user dict.

    Raises:
        HTTPException 404: If no user exists with *user_id*.
    """
    fields = user_in.model_dump(exclude_unset=True, exclude_none=True)
    updated = user_dynamo.update(user_id, fields)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return updated


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: str,
    _: dict = Depends(require_roles(Role.ADMIN)),
) -> None:
    """Permanently delete a user account from DynamoDB.

    Args:
        user_id: UUID string primary key of the user to delete.
        _: Role guard — ADMIN only.

    Raises:
        HTTPException 404: If no user exists with *user_id*.
    """
    user = user_dynamo.get_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    user_dynamo.delete(user_id)


@router.post("/me/avatar", response_model=UserResponse)
async def upload_user_avatar(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_active_user),
) -> dict:
    """Replace the current user's avatar image (stored in S3).

    Validates MIME type and file size, uploads to S3, deletes the previous
    avatar from S3, and saves the new S3 URL in DynamoDB.

    Args:
        file: Uploaded image file from the multipart form.
        current_user: Authenticated user dict.

    Returns:
        The updated user dict with the new ``avatar_url``.

    Raises:
        HTTPException 400: If the MIME type is not in ``ALLOWED_TYPES`` or the
            file exceeds ``MAX_AVATAR_SIZE``.
    """
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only JPEG, PNG, WebP or GIF images are allowed.",
        )

    contents = await file.read()
    if len(contents) > MAX_AVATAR_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image must be smaller than 3 MB.",
        )

    # Delete old avatar from S3 if present
    old_url = current_user.get("avatar_url")
    if old_url:
        delete_avatar(old_url)

    # Upload new avatar to S3
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "jpg"
    s3_url = upload_avatar(
        contents=contents,
        content_type=file.content_type,
        user_id=current_user["user_id"],
        ext=ext,
    )

    # Persist S3 URL in DynamoDB
    updated = user_dynamo.update(current_user["user_id"], {"avatar_url": s3_url})
    return updated or {**current_user, "avatar_url": s3_url}


@router.delete("/me/avatar", response_model=UserResponse)
def remove_user_avatar(
    current_user: dict = Depends(get_current_active_user),
) -> dict:
    """Remove the current user's avatar (deletes from S3 and clears in DynamoDB).

    A no-op if the user has no avatar.

    Args:
        current_user: Authenticated user dict.

    Returns:
        The updated user dict with ``avatar_url`` set to ``None``.
    """
    old_url = current_user.get("avatar_url")
    if old_url:
        delete_avatar(old_url)
        updated = user_dynamo.update(current_user["user_id"], {"avatar_url": None})
        return updated or {**current_user, "avatar_url": None}
    return current_user
