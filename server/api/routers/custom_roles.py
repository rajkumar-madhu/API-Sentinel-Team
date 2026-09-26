"""
Custom RBAC roles — per-account named permission sets, for organizations whose
member roles don't map cleanly onto the fixed VIEWER/AUDITOR/MEMBER/DEVELOPER/
SECURITY_ENGINEER/ADMIN roles (see server/modules/auth/rbac.py).

Management is restricted to USERS_MANAGE, which only ADMIN/PLATFORM_ADMIN hold
in ROLE_PERMISSIONS — consistent with fixed-role assignment already requiring
admin access via organization.py.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete as sa_delete, func, select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from server.modules.auth.rbac import Permission, RBAC, ROLE_PERMISSIONS, _ALL
from server.modules.persistence.database import get_db
from server.models.core import CustomRole, User

router = APIRouter()

# GUEST is the frontend's unauthenticated placeholder role.
RESERVED_NAMES = set(ROLE_PERMISSIONS.keys()) | {"GUEST"}


def _validate_name(name: str) -> str:
    name = (name or "").strip().upper()
    if not name or len(name) > 100:
        raise HTTPException(400, "name must be 1-100 characters")
    if name in RESERVED_NAMES:
        raise HTTPException(400, f"'{name}' is a fixed role name and cannot be used for a custom role")
    return name


def _validate_permissions(permissions: List[str]) -> List[str]:
    if not isinstance(permissions, list) or not permissions:
        raise HTTPException(400, "permissions must be a non-empty list")
    invalid = sorted(set(permissions) - _ALL)
    if invalid:
        raise HTTPException(400, f"Unknown permissions: {invalid}")
    return sorted(set(permissions))


def _serialize(role: CustomRole) -> dict:
    return {
        "id": role.id,
        "name": role.name,
        "description": role.description,
        "permissions": role.permissions or [],
        "created_at": role.created_at,
        "updated_at": role.updated_at,
    }


@router.get("/")
async def list_custom_roles(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(RBAC.require_permission(Permission.USERS_MANAGE)),
):
    account_id = payload["account_id"]
    result = await db.execute(select(CustomRole).where(CustomRole.account_id == account_id))
    return {"roles": [_serialize(r) for r in result.scalars().all()]}


@router.post("/")
async def create_custom_role(
    name: str = Body(...),
    permissions: List[str] = Body(...),
    description: Optional[str] = Body(None),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(RBAC.require_permission(Permission.USERS_MANAGE)),
):
    account_id = payload["account_id"]
    validated_name = _validate_name(name)
    validated_permissions = _validate_permissions(permissions)

    existing = await db.scalar(
        select(CustomRole).where(CustomRole.account_id == account_id, CustomRole.name == validated_name)
    )
    if existing:
        raise HTTPException(409, f"Custom role '{validated_name}' already exists")

    role = CustomRole(
        id=str(uuid.uuid4()),
        account_id=account_id,
        name=validated_name,
        description=description,
        permissions=validated_permissions,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    return _serialize(role)


@router.patch("/{role_id}")
async def update_custom_role(
    role_id: str,
    permissions: Optional[List[str]] = Body(None),
    description: Optional[str] = Body(None),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(RBAC.require_permission(Permission.USERS_MANAGE)),
):
    account_id = payload["account_id"]
    updates: dict = {}
    if permissions is not None:
        updates["permissions"] = _validate_permissions(permissions)
    if description is not None:
        updates["description"] = description
    if not updates:
        raise HTTPException(400, "No updates provided")

    result = await db.execute(
        sa_update(CustomRole)
        .where(CustomRole.id == role_id, CustomRole.account_id == account_id)
        .values(**updates)
    )
    if result.rowcount == 0:
        raise HTTPException(404, "Custom role not found")
    await db.commit()
    return {"id": role_id, "updated": list(updates.keys())}


@router.delete("/{role_id}")
async def delete_custom_role(
    role_id: str,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(RBAC.require_permission(Permission.USERS_MANAGE)),
):
    account_id = payload["account_id"]
    # Lock the role so invites/role updates (which take FOR SHARE on it)
    # can't assign it between the in-use count below and the delete.
    role = await db.scalar(
        select(CustomRole)
        .where(CustomRole.id == role_id, CustomRole.account_id == account_id)
        .with_for_update()
    )
    if not role:
        raise HTTPException(404, "Custom role not found")

    # Deleting a role that users still hold would silently resolve them to an
    # empty permission set on their next request.
    assigned = await db.scalar(
        select(func.count()).select_from(User).where(User.account_id == account_id, User.role == role.name)
    )
    if assigned:
        raise HTTPException(409, f"Role '{role.name}' is assigned to {assigned} user(s); reassign them first")

    await db.execute(sa_delete(CustomRole).where(CustomRole.id == role_id, CustomRole.account_id == account_id))
    await db.commit()
    return {"deleted": role_id}


@router.get("/permissions")
async def list_available_permissions(
    payload: dict = Depends(RBAC.require_permission(Permission.USERS_MANAGE)),
):
    """All Permission values a custom role can be granted."""
    return {"permissions": sorted(_ALL)}
