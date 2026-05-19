"""Menu and MenuAccess endpoints backed by DynamoDB."""

import uuid
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.core.roles import Role, require_roles
from app.db.dynamo import dynamo_menus, dynamo_menu_access
from app.dependencies import get_current_active_user

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class MenuCreate(BaseModel):
    name: str
    path: str
    icon: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: int = 0
    is_active: bool = True


class MenuUpdate(BaseModel):
    name: Optional[str] = None
    path: Optional[str] = None
    icon: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class MenuResponse(BaseModel):
    id: int
    name: str
    path: str
    icon: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: int
    is_active: bool


class MenuWithAccess(BaseModel):
    id: int
    name: str
    path: str
    icon: Optional[str] = None
    sort_order: int
    can_view: bool
    can_insert: bool
    can_update: bool
    can_delete: bool


class MenuAccessCreate(BaseModel):
    menu_id: int
    role: str
    can_view: bool = False
    can_insert: bool = False
    can_update: bool = False
    can_delete: bool = False


class MenuAccessUpdate(BaseModel):
    can_view: Optional[bool] = None
    can_insert: Optional[bool] = None
    can_update: Optional[bool] = None
    can_delete: Optional[bool] = None


class MenuAccessResponse(BaseModel):
    id: str
    menu_id: int
    role: str
    can_view: bool
    can_insert: bool
    can_update: bool
    can_delete: bool
    menu_name: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_menu_response(item: dict) -> MenuResponse:
    return MenuResponse(
        id=int(item["menu_id"]),
        name=item["name"],
        path=item["path"],
        icon=item.get("icon"),
        parent_id=int(item["parent_id"]) if item.get("parent_id") else None,
        sort_order=int(item.get("sort_order", 0)),
        is_active=bool(item.get("is_active", True)),
    )


def _all_menus() -> List[dict]:
    resp = dynamo_menus.scan()
    return sorted(resp.get("Items", []), key=lambda x: int(x.get("sort_order", 0)))


def _all_access() -> List[dict]:
    resp = dynamo_menu_access.scan()
    return resp.get("Items", [])


# ── My menus (sidebar) ────────────────────────────────────────────────────────

@router.get("/my-menus", response_model=List[MenuWithAccess])
def get_my_menus(current_user=Depends(get_current_active_user)):
    menus = _all_menus()
    access_rows = _all_access()

    # Build role-based access map: {menu_id: {...perms}}
    access_map = {}
    for row in access_rows:
        if row.get("role") == current_user["role"]:
            mid = str(row["menu_id"])
            access_map[mid] = row

    result = []
    for m in menus:
        if not m.get("is_active", True):
            continue
        mid = str(m["menu_id"])
        acc = access_map.get(mid, {})
        if not acc.get("can_view", False):
            continue
        result.append(MenuWithAccess(
            id=int(m["menu_id"]),
            name=m["name"],
            path=m["path"],
            icon=m.get("icon"),
            sort_order=int(m.get("sort_order", 0)),
            can_view=bool(acc.get("can_view", False)),
            can_insert=bool(acc.get("can_insert", False)),
            can_update=bool(acc.get("can_update", False)),
            can_delete=bool(acc.get("can_delete", False)),
        ))
    return result


# ── Menu CRUD ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[MenuResponse])
def list_menus(_=Depends(require_roles(Role.ADMIN))):
    return [_to_menu_response(m) for m in _all_menus()]


@router.post("/", response_model=MenuResponse, status_code=status.HTTP_201_CREATED)
def create_menu(menu_in: MenuCreate, _=Depends(require_roles(Role.ADMIN))):
    all_ids = [int(m["menu_id"]) for m in _all_menus()]
    new_id = max(all_ids, default=0) + 1
    item = {
        "menu_id": str(new_id),
        "name": menu_in.name,
        "path": menu_in.path,
        "sort_order": Decimal(str(menu_in.sort_order)),
        "is_active": menu_in.is_active,
    }
    if menu_in.icon:
        item["icon"] = menu_in.icon
    if menu_in.parent_id is not None:
        item["parent_id"] = str(menu_in.parent_id)
    dynamo_menus.put_item(Item=item)
    return _to_menu_response(item)


@router.put("/{menu_id}", response_model=MenuResponse)
def update_menu(menu_id: int, menu_in: MenuUpdate, _=Depends(require_roles(Role.ADMIN))):
    resp = dynamo_menus.get_item(Key={"menu_id": str(menu_id)})
    item = resp.get("Item")
    if not item:
        raise HTTPException(status_code=404, detail="Menu not found")
    updates = menu_in.model_dump(exclude_none=True)
    if "sort_order" in updates:
        updates["sort_order"] = Decimal(str(updates["sort_order"]))
    if "parent_id" in updates:
        updates["parent_id"] = str(updates["parent_id"]) if updates["parent_id"] else None
    item.update(updates)
    dynamo_menus.put_item(Item=item)
    return _to_menu_response(item)


@router.delete("/{menu_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_menu(menu_id: int, _=Depends(require_roles(Role.ADMIN))):
    resp = dynamo_menus.get_item(Key={"menu_id": str(menu_id)})
    if not resp.get("Item"):
        raise HTTPException(status_code=404, detail="Menu not found")
    dynamo_menus.delete_item(Key={"menu_id": str(menu_id)})


# ── Menu Access CRUD ──────────────────────────────────────────────────────────

@router.get("/access/", response_model=List[MenuAccessResponse])
def list_menu_access(_=Depends(require_roles(Role.ADMIN))):
    access_rows = _all_access()
    menus = {str(m["menu_id"]): m["name"] for m in _all_menus()}
    result = []
    for row in access_rows:
        result.append(MenuAccessResponse(
            id=str(row["access_id"]),
            menu_id=int(row["menu_id"]),
            role=row["role"],
            can_view=bool(row.get("can_view", False)),
            can_insert=bool(row.get("can_insert", False)),
            can_update=bool(row.get("can_update", False)),
            can_delete=bool(row.get("can_delete", False)),
            menu_name=menus.get(str(row["menu_id"])),
        ))
    return result


@router.post("/access/", response_model=MenuAccessResponse, status_code=status.HTTP_201_CREATED)
def upsert_menu_access(access_in: MenuAccessCreate, _=Depends(require_roles(Role.ADMIN))):
    # Check if rule for this menu+role already exists
    all_access = _all_access()
    existing = next(
        (r for r in all_access
         if str(r["menu_id"]) == str(access_in.menu_id) and r["role"] == access_in.role),
        None
    )
    access_id = existing["access_id"] if existing else str(uuid.uuid4())
    item = {
        "access_id": access_id,
        "menu_id": str(access_in.menu_id),
        "role": access_in.role,
        "can_view": access_in.can_view,
        "can_insert": access_in.can_insert,
        "can_update": access_in.can_update,
        "can_delete": access_in.can_delete,
    }
    dynamo_menu_access.put_item(Item=item)
    return MenuAccessResponse(id=access_id, **{k: v for k, v in item.items() if k != "access_id"})


@router.put("/access/{access_id}", response_model=MenuAccessResponse)
def update_menu_access(access_id: str, access_in: MenuAccessUpdate, _=Depends(require_roles(Role.ADMIN))):
    resp = dynamo_menu_access.get_item(Key={"access_id": access_id})
    item = resp.get("Item")
    if not item:
        raise HTTPException(status_code=404, detail="Access record not found")
    updates = access_in.model_dump(exclude_none=True)
    item.update(updates)
    dynamo_menu_access.put_item(Item=item)
    return MenuAccessResponse(
        id=item["access_id"],
        menu_id=int(item["menu_id"]),
        role=item["role"],
        can_view=bool(item.get("can_view", False)),
        can_insert=bool(item.get("can_insert", False)),
        can_update=bool(item.get("can_update", False)),
        can_delete=bool(item.get("can_delete", False)),
    )


@router.delete("/access/{access_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_menu_access(access_id: str, _=Depends(require_roles(Role.ADMIN))):
    resp = dynamo_menu_access.get_item(Key={"access_id": access_id})
    if not resp.get("Item"):
        raise HTTPException(status_code=404, detail="Access record not found")
    dynamo_menu_access.delete_item(Key={"access_id": access_id})
