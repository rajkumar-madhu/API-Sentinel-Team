"""PostgreSQL Row-Level Security (RLS) enforcement for multi-tenant isolation.

RLS is the backstop for the tenancy invariant. Application code is supposed to
filter every query on ``account_id``; when someone forgets, RLS turns a
cross-tenant data leak into an empty result set instead of a breach.

Three properties matter, and getting any of them wrong makes RLS look enabled
while enforcing nothing:

1. **Coverage.** Policies are derived from the ORM metadata — every mapped table
   with an ``account_id`` column gets them — rather than a hand-maintained list
   that silently falls behind as tables are added. An earlier version of this
   module listed four tables out of sixty-nine.

2. **FORCE.** Postgres exempts a table's *owner* from its RLS policies unless
   the table is set to ``FORCE ROW LEVEL SECURITY``. This application connects
   as the user that owns its tables, so without FORCE every policy here would be
   bypassed on every query. FORCE is not optional for this deployment.

3. **A set tenant.** Policies compare ``account_id`` against a session variable.
   ``current_setting(name)`` raises ``undefined_object`` when the variable was
   never set, which would turn a missing tenant context into a 500 on every
   query. Policies here use the two-argument ``current_setting(name, true)``,
   which returns NULL instead, so an unset tenant yields *no rows* — closed, not
   broken, and not an outage.

RLS is PostgreSQL-only; SQLite ignores all of this, which is why the test suite
asserts on generated SQL rather than on behaviour when running against SQLite.

Enabling this on an existing database is a migration, not a config flag. See
``docs/RLS_ROLLOUT.md``.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from server.config import settings
from server.models import Base

logger = logging.getLogger(__name__)

# Operations needing a USING clause (row visibility) vs a WITH CHECK clause
# (row admissibility on write). UPDATE needs both: USING picks which rows may be
# updated, WITH CHECK stops an update from moving a row to another tenant.
_TENANT_COLUMN = "account_id"


def tenant_tables() -> list[str]:
    """Every mapped table carrying the tenant column, sorted for stable output.

    Derived from ORM metadata so a new multi-tenant table is covered the moment
    it is defined, with no second edit to remember here.
    """
    return sorted(
        name
        for name, table in Base.metadata.tables.items()
        if _TENANT_COLUMN in table.columns
    )


def _setting() -> str:
    return settings.TENANT_RLS_SETTING_NAME


def _tenant_expr() -> str:
    """SQL for the current tenant, NULL when unset rather than an error.

    The two-argument form of ``current_setting`` is what keeps a missing tenant
    context from raising. NULL then makes every comparison NULL, so the policy
    admits no rows.
    """
    return f"NULLIF(current_setting('{_setting()}', true), '')::bigint"


def policy_statements_for_table(table_name: str) -> list[str]:
    """The full set of statements that put one table under tenant isolation."""
    tenant = _tenant_expr()
    match = f"{_TENANT_COLUMN} = {tenant}"
    return [
        f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;",
        # Without FORCE, the table owner -- which is the account this app
        # connects as -- bypasses every policy below.
        f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY;",
        f"DROP POLICY IF EXISTS {table_name}_tenant_select ON {table_name};",
        f"CREATE POLICY {table_name}_tenant_select ON {table_name} "
        f"FOR SELECT USING ({match});",
        f"DROP POLICY IF EXISTS {table_name}_tenant_insert ON {table_name};",
        f"CREATE POLICY {table_name}_tenant_insert ON {table_name} "
        f"FOR INSERT WITH CHECK ({match});",
        f"DROP POLICY IF EXISTS {table_name}_tenant_update ON {table_name};",
        f"CREATE POLICY {table_name}_tenant_update ON {table_name} "
        f"FOR UPDATE USING ({match}) WITH CHECK ({match});",
        f"DROP POLICY IF EXISTS {table_name}_tenant_delete ON {table_name};",
        f"CREATE POLICY {table_name}_tenant_delete ON {table_name} "
        f"FOR DELETE USING ({match});",
    ]


def disable_statements_for_table(table_name: str) -> list[str]:
    return [
        f"DROP POLICY IF EXISTS {table_name}_tenant_select ON {table_name};",
        f"DROP POLICY IF EXISTS {table_name}_tenant_insert ON {table_name};",
        f"DROP POLICY IF EXISTS {table_name}_tenant_update ON {table_name};",
        f"DROP POLICY IF EXISTS {table_name}_tenant_delete ON {table_name};",
        f"ALTER TABLE {table_name} NO FORCE ROW LEVEL SECURITY;",
        f"ALTER TABLE {table_name} DISABLE ROW LEVEL SECURITY;",
    ]


def rls_setup_sql() -> list[str]:
    """Every statement needed to put the whole schema under tenant isolation."""
    return [stmt for t in tenant_tables() for stmt in policy_statements_for_table(t)]


def rls_teardown_sql() -> list[str]:
    return [stmt for t in tenant_tables() for stmt in disable_statements_for_table(t)]


async def enable_rls_on_all_tables(db: AsyncSession) -> dict:
    """Apply tenant isolation to every mapped table carrying ``account_id``.

    Each table is committed on its own so one failure (a table absent from this
    database, say) does not roll back the tables that succeeded. The returned
    dict reports per-table status; callers should treat any ``error`` as a
    reason not to turn ``TENANT_RLS_ENABLED`` on.
    """
    results: dict[str, dict] = {}
    for table_name in tenant_tables():
        try:
            for statement in policy_statements_for_table(table_name):
                await db.execute(text(statement))
            await db.commit()
            results[table_name] = {"status": "success", "message": "RLS enforced"}
            logger.info("rls_enabled_table: %s", table_name)
        except Exception as exc:  # noqa: BLE001 - reported per table, not raised
            await db.rollback()
            results[table_name] = {"status": "error", "message": str(exc)}
            logger.error("rls_setup_failed_table: %s, error: %s", table_name, exc)
    return results


async def disable_rls_on_all_tables(db: AsyncSession) -> dict:
    """Remove tenant isolation. Used by migrations and by tests."""
    results: dict[str, dict] = {}
    for table_name in tenant_tables():
        try:
            for statement in disable_statements_for_table(table_name):
                await db.execute(text(statement))
            await db.commit()
            results[table_name] = {"status": "success"}
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            results[table_name] = {"status": "error", "message": str(exc)}
            logger.error("rls_disable_failed: %s, error: %s", table_name, exc)
    return results


async def verify_rls_coverage(db: AsyncSession) -> dict:
    """Report which tenant tables are actually protected in this database.

    Enabling the feature flag without checking this is how RLS ends up looking
    enabled while enforcing nothing, so the rollout doc makes this a gate. A
    table counts as protected only when it has RLS enabled, FORCE set, and at
    least one policy.
    """
    rows = await db.execute(
        text(
            """
            SELECT c.relname AS table_name,
                   c.relrowsecurity AS rls_enabled,
                   c.relforcerowsecurity AS rls_forced,
                   (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r'
            """
        )
    )
    state = {
        r.table_name: {
            "rls_enabled": bool(r.rls_enabled),
            "rls_forced": bool(r.rls_forced),
            "policies": int(r.policies),
        }
        for r in rows
    }

    protected, unprotected = [], []
    for table_name in tenant_tables():
        info = state.get(table_name)
        if info and info["rls_enabled"] and info["rls_forced"] and info["policies"]:
            protected.append(table_name)
        else:
            unprotected.append(table_name)

    return {
        "tenant_tables": len(tenant_tables()),
        "protected": protected,
        "unprotected": unprotected,
        "fully_covered": not unprotected,
    }


async def set_current_account_id(db: AsyncSession, account_id: int) -> None:
    """Set the tenant for the current transaction.

    ``SET LOCAL`` scopes the value to the surrounding transaction, so it cannot
    leak to the next request that borrows this pooled connection. The value is
    bound as a parameter rather than interpolated.
    """
    await db.execute(
        text(f"SET LOCAL {_setting()} = :account_id"),
        {"account_id": str(int(account_id))},
    )
