"""
Data subject access & erasure (DSAR) — GDPR Art. 15/17-style export and
erasure of an organization member's personal data held by the platform.

Two entry points:
  - self-service: the authenticated user exporting/erasing their own record
  - admin-driven: an account ADMIN (or PLATFORM_ADMIN) acting on a member,
    gated the same way organization.py gates member management
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from server.modules.auth.audit import log_action
from server.modules.auth.rbac import Permission, RBAC
from server.modules.persistence.database import get_db
from server.models.core import ApiToken, AuditLog, User

router = APIRouter()


def _require_account_access(payload: dict, account_id: int) -> None:
    role = (payload.get("role") or "").upper()
    if role == "PLATFORM_ADMIN":
        return
    if role == "ADMIN" and int(payload.get("account_id") or 0) == int(account_id):
        return
    raise HTTPException(status_code=403, detail="Not authorized for this organization")


async def _load_member(db: AsyncSession, account_id: int, user_id: str) -> User:
    result = await db.execute(
        select(User).where(User.id == user_id, User.account_id == account_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found in this organization")
    return user


async def _export_payload(db: AsyncSession, user: User) -> dict:
    tokens_result = await db.execute(
        select(ApiToken).where(ApiToken.user_id == user.id, ApiToken.account_id == user.account_id)
    )
    logs_result = await db.execute(
        select(AuditLog)
        .where(AuditLog.user_id == user.id, AuditLog.account_id == user.account_id)
        .order_by(AuditLog.id.desc())
        .limit(1000)
    )
    return {
        "user": {
            "id": user.id,
            "account_id": user.account_id,
            "email": user.email,
            "role": user.role,
            "created_at": user.created_at.isoformat() if user.created_at else None,
        },
        "api_tokens": [
            {
                "id": token.id,
                "name": token.name,
                "scopes": token.scopes,
                "created_at": token.created_at.isoformat() if token.created_at else None,
                "expires_at": token.expires_at.isoformat() if token.expires_at else None,
            }
            for token in tokens_result.scalars().all()
        ],
        "audit_log_actions": [
            {
                "id": log.id,
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs_result.scalars().all()
        ],
    }


@router.get("/export/me")
async def export_own_data(
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(RBAC.require_auth),
):
    """Export the authenticated user's own personal data (self-service DSAR)."""
    user = await _load_member(db, payload["account_id"], payload["user_id"])
    return await _export_payload(db, user)


@router.get("/export/{user_id}")
async def export_member_data(
    user_id: str,
    account_id: int,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(RBAC.require_permission(Permission.USERS_MANAGE)),
):
    """Export a specific member's personal data. Requires org admin access."""
    _require_account_access(payload, account_id)
    user = await _load_member(db, account_id, user_id)
    return await _export_payload(db, user)


@router.post("/erase/{user_id}")
async def erase_member_data(
    user_id: str,
    account_id: int,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(RBAC.require_permission(Permission.USERS_MANAGE)),
):
    """
    Erase a member's personal data (right to erasure).

    Deletes their API tokens and user record, and de-identifies their audit
    trail (the action history is retained for security/compliance purposes,
    but is no longer attributable to this person) rather than deleting it
    outright.
    """
    _require_account_access(payload, account_id)
    user = await _load_member(db, account_id, user_id)

    if user.id == payload.get("user_id"):
        raise HTTPException(status_code=400, detail="Cannot erase your own account while authenticated as it")

    await db.execute(delete(ApiToken).where(ApiToken.user_id == user.id, ApiToken.account_id == account_id))
    await db.execute(
        update(AuditLog)
        .where(AuditLog.user_id == user.id, AuditLog.account_id == account_id)
        .values(user_id=None)
    )
    erased_email = user.email
    await db.delete(user)

    await log_action(
        db,
        account_id=account_id,
        action="dsar.erase",
        user_id=payload.get("user_id"),
        resource_type="user",
        resource_id=user_id,
        details={"erased_email_domain": erased_email.split("@")[-1] if "@" in erased_email else None},
    )
    await db.commit()
    return {"status": "erased", "user_id": user_id}
