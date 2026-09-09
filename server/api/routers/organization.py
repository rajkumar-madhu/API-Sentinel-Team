"""Organization — tenant-scoped account, members, and attention inbox."""
import secrets

from fastapi import APIRouter, Depends, HTTPException, Body, Query
from sqlalchemy.future import select
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession

from server.models.core import Account, User, APIEndpoint, Vulnerability, TestRun
from server.modules.auth.password_hasher import PasswordHasher
from server.modules.auth.rbac import RBAC, Permission
from server.modules.organization.attention import build_attention
from server.modules.persistence.database import get_db
from server.modules.validation.input_validator import InputValidator, ValidationError

router = APIRouter()

PLAN_TIERS = {"FREE", "STARTER", "PRO", "ENTERPRISE"}
_INVITE_ROLES = {"ADMIN", "SECURITY_ENGINEER", "DEVELOPER", "MEMBER", "AUDITOR", "VIEWER"}


def _tenant_account_id(user: dict) -> int:
    try:
        return int(user["account_id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Invalid token: account_id missing") from exc


def _require_own_account(user: dict, account_id: int) -> int:
    tenant_id = _tenant_account_id(user)
    if account_id != tenant_id:
        raise HTTPException(status_code=404, detail="Organization not found")
    return tenant_id


def _serialize_account(account: Account) -> dict:
    return {
        "id": account.id,
        "name": account.name,
        "plan_tier": account.plan_tier,
        "created_at": str(account.created_at),
    }


async def _usage_stats(db: AsyncSession, account_id: int) -> dict:
    user_count = await db.scalar(
        select(func.count(User.id)).where(User.account_id == account_id)
    ) or 0
    endpoint_count = await db.scalar(
        select(func.count(APIEndpoint.id)).where(APIEndpoint.account_id == account_id)
    ) or 0
    open_vulns = await db.scalar(
        select(func.count(Vulnerability.id)).where(
            Vulnerability.account_id == account_id,
            Vulnerability.status == "OPEN",
        )
    ) or 0
    test_runs = await db.scalar(
        select(func.count(TestRun.id)).where(TestRun.account_id == account_id)
    ) or 0
    return {
        "users": int(user_count),
        "endpoints": int(endpoint_count),
        "open_vulnerabilities": int(open_vulns),
        "test_runs": int(test_runs),
    }


@router.get("/")
async def list_organizations(
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(RBAC.require_auth),
):
    """Return the caller's tenant only — never a cross-tenant directory."""
    account_id = _tenant_account_id(user)
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        return {"total": 0, "organizations": []}
    return {"total": 1, "organizations": [_serialize_account(account)]}


@router.get("/attention")
async def organization_attention(
    window_hours: int = Query(24, description="24 or 168"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(RBAC.require_auth),
):
    """What requires attention now — tenant-scoped, evidence-aware, no invented metrics."""
    account_id = _tenant_account_id(user)
    if window_hours not in {24, 168}:
        raise HTTPException(status_code=400, detail="window_hours must be 24 or 168")
    return await build_attention(db, account_id, window_hours=window_hours)


@router.get("/{account_id}")
async def get_organization(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(RBAC.require_auth),
):
    """Get the caller's organization details including usage stats."""
    _require_own_account(user, account_id)
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Organization not found")

    payload = _serialize_account(account)
    payload["usage"] = await _usage_stats(db, account_id)
    return payload


@router.patch("/{account_id}")
async def update_organization(
    account_id: int,
    name: str = Body(None),
    plan_tier: str = Body(None),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(RBAC.require_permission(Permission.ACCOUNTS_MANAGE)),
):
    """Update organization name or plan tier for the caller's tenant."""
    _require_own_account(user, account_id)
    result = await db.execute(select(Account).where(Account.id == account_id))
    account = result.scalar_one_or_none()
    if not account:
        raise HTTPException(status_code=404, detail="Organization not found")

    if name:
        try:
            account.name = InputValidator.validate_string(
                name, "name", max_length=256, allow_empty=False
            )
        except ValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if plan_tier:
        if plan_tier.upper() not in PLAN_TIERS:
            raise HTTPException(status_code=400, detail=f"plan_tier must be one of: {PLAN_TIERS}")
        account.plan_tier = plan_tier.upper()

    await db.commit()
    return {"status": "updated", "id": account_id, "name": account.name, "plan_tier": account.plan_tier}


@router.get("/{account_id}/members")
async def list_members(
    account_id: int,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(RBAC.require_auth),
):
    """List users belonging to the caller's organization."""
    _require_own_account(user, account_id)
    result = await db.execute(select(User).where(User.account_id == account_id))
    users = result.scalars().all()
    return {
        "account_id": account_id,
        "total": len(users),
        "members": [
            {"id": u.id, "email": u.email, "role": u.role, "created_at": str(u.created_at)}
            for u in users
        ],
    }


@router.post("/{account_id}/invite")
async def invite_member(
    account_id: int,
    email: str = Body(...),
    role: str = Body("MEMBER", description="ADMIN | SECURITY_ENGINEER | DEVELOPER | MEMBER | AUDITOR | VIEWER"),
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(RBAC.require_permission(Permission.USERS_MANAGE)),
):
    """
    Invite a new member to the caller's organization.

    Creates the user with a one-time temporary password returned in this
    response only — share it out of band; there is no email invite flow yet.
    """
    _require_own_account(user, account_id)
    try:
        email = InputValidator.validate_email(email)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    invited_role = (role or "MEMBER").upper()
    if invited_role not in _INVITE_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of: {sorted(_INVITE_ROLES)}")

    result = await db.execute(select(Account).where(Account.id == account_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Organization not found")

    existing = await db.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    temporary_password = secrets.token_urlsafe(18)
    invited = User(
        account_id=account_id,
        email=email,
        password_hash=PasswordHasher.hash_password(temporary_password),
        role=invited_role,
    )
    db.add(invited)
    await db.commit()
    return {
        "status": "invited",
        "user_id": invited.id,
        "email": email,
        "role": invited.role,
        "temporary_password": temporary_password,
        "note": "Share the temporary password out of band. It is shown only once.",
    }


@router.delete("/{account_id}/members/{user_id}")
async def remove_member(
    account_id: int,
    user_id: str,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(RBAC.require_permission(Permission.USERS_MANAGE)),
):
    """Remove a member from the caller's organization."""
    _require_own_account(user, account_id)
    result = await db.execute(
        select(User).where(User.id == user_id, User.account_id == account_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="User not found in this organization")
    await db.delete(member)
    await db.commit()
    return {"status": "removed", "user_id": user_id}
