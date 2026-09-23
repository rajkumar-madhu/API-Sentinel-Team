"""
Billing quota enforcement — checks BillingSubscription/BillingPlan limits
before endpoint creation, user invites, and scan runs, and increments the
monthly scan counter (server/api/routers/billing.py assigns plans and resets
the counter on Stripe's invoice.payment_succeeded).

An account with no ACTIVE BillingSubscription row is treated as unlimited —
quotas only bite once an account has actually been put on a plan via
POST /billing/subscription/{account_id}/assign. This keeps self-hosted /
open-source deployments (which never call that endpoint) unaffected.
"""
from typing import Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from server.models.core import APIEndpoint, BillingPlan, BillingSubscription, User

UNLIMITED = -1


async def _active_plan(db: AsyncSession, account_id: int) -> Tuple[Optional[BillingSubscription], Optional[BillingPlan]]:
    sub_result = await db.execute(
        select(BillingSubscription).where(
            BillingSubscription.account_id == account_id,
            BillingSubscription.status == "ACTIVE",
        )
    )
    subscription = sub_result.scalar_one_or_none()
    if not subscription:
        return None, None
    plan_result = await db.execute(select(BillingPlan).where(BillingPlan.id == subscription.plan_id))
    plan = plan_result.scalar_one_or_none()
    if not plan:
        return None, None
    return subscription, plan


async def enforce_endpoint_quota(db: AsyncSession, account_id: int) -> None:
    _, plan = await _active_plan(db, account_id)
    if plan is None or plan.max_endpoints == UNLIMITED:
        return
    count = (await db.execute(
        select(func.count()).select_from(APIEndpoint).where(APIEndpoint.account_id == account_id)
    )).scalar()
    if count >= plan.max_endpoints:
        raise HTTPException(
            402, f"Endpoint limit reached ({plan.max_endpoints}) for plan '{plan.name}'. Upgrade to add more."
        )


async def enforce_user_quota(db: AsyncSession, account_id: int) -> None:
    _, plan = await _active_plan(db, account_id)
    if plan is None or plan.max_users == UNLIMITED:
        return
    count = (await db.execute(
        select(func.count()).select_from(User).where(User.account_id == account_id)
    )).scalar()
    if count >= plan.max_users:
        raise HTTPException(
            402, f"User limit reached ({plan.max_users}) for plan '{plan.name}'. Upgrade to add more."
        )


async def reserve_scan_usage(db: AsyncSession, account_id: int) -> None:
    """Atomically check-and-increment the monthly scan counter.

    A separate read-then-write (check scans_used_this_month, then a later
    unconditional +1) leaves a window where concurrent scan requests can all
    read the same pre-increment count, all pass, and collectively exceed
    max_scans_per_month. Folding the check into the UPDATE's WHERE clause
    closes that window: the database evaluates the condition against the
    row's current value as part of the same atomic statement, so at most
    one of a set of racing requests can claim the last unit of quota.
    """
    _, plan = await _active_plan(db, account_id)
    if plan is None or plan.max_scans_per_month == UNLIMITED:
        return
    result = await db.execute(
        update(BillingSubscription)
        .where(
            BillingSubscription.account_id == account_id,
            BillingSubscription.status == "ACTIVE",
            BillingSubscription.scans_used_this_month < plan.max_scans_per_month,
        )
        .values(scans_used_this_month=BillingSubscription.scans_used_this_month + 1)
    )
    if result.rowcount == 0:
        raise HTTPException(
            402,
            f"Monthly scan limit reached ({plan.max_scans_per_month}) for plan '{plan.name}'. "
            "Upgrade or wait for the next billing period.",
        )
