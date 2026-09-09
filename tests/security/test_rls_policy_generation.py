"""RLS generates correct, complete policies for every multi-tenant table.

These assert on the generated SQL rather than on live behaviour, so they run on
SQLite in CI. Postgres ignores none of this, but SQLite has no RLS at all, and a
test that silently passes because the backend cannot enforce anything is worse
than no test.

The three properties pinned here are the three ways RLS ends up looking enabled
while enforcing nothing:

  coverage  -- policies must come from ORM metadata, not a hand-kept list that
               falls behind. The version this replaced covered 4 of 69 tables.
  FORCE     -- the app connects as its tables' owner, and Postgres exempts the
               owner from RLS unless the table is set to FORCE.
  unset     -- an unset tenant must yield no rows, not an exception on every
               query.
"""
import re

import pytest

from server.config import settings
from server.models import Base
from server.modules.rls.row_level_security import (
    disable_statements_for_table,
    policy_statements_for_table,
    rls_setup_sql,
    tenant_tables,
)


def _orm_tenant_tables() -> set[str]:
    return {
        name
        for name, table in Base.metadata.tables.items()
        if "account_id" in table.columns
    }


def test_every_multi_tenant_table_is_covered():
    """No mapped table with account_id may be left out of the policy set."""
    covered = set(tenant_tables())
    missing = _orm_tenant_tables() - covered
    assert not missing, (
        "These tables carry account_id but get no RLS policy:\n"
        + "\n".join(f"  {t}" for t in sorted(missing))
    )


def test_coverage_is_substantial_not_a_stub():
    """Guard against the generator regressing to a hand-picked handful.

    The concrete failure this pins: a previous implementation hard-coded four
    tables, so 'RLS enabled' protected 6% of the tenant surface.
    """
    assert len(tenant_tables()) > 50, (
        f"Only {len(tenant_tables())} tenant tables resolved; the generator has "
        "probably stopped reading ORM metadata."
    )


def test_tables_without_account_id_are_excluded():
    """Non-tenant tables must not get a policy comparing a column they lack."""
    non_tenant = set(Base.metadata.tables) - _orm_tenant_tables()
    overreach = non_tenant & set(tenant_tables())
    assert not overreach, f"policies generated for non-tenant tables: {overreach}"


@pytest.mark.parametrize("table", sorted(_orm_tenant_tables())[:12])
def test_each_table_enables_and_forces_rls(table):
    """ENABLE alone is not enough -- without FORCE the owner bypasses policies."""
    sql = " ".join(policy_statements_for_table(table))
    assert f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY" in sql
    assert f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY" in sql, (
        f"{table} enables RLS without FORCE; the table owner would bypass every "
        "policy, which is how RLS silently enforces nothing."
    )


@pytest.mark.parametrize("table", sorted(_orm_tenant_tables())[:12])
def test_each_table_covers_all_four_operations(table):
    sql = " ".join(policy_statements_for_table(table))
    for op in ("SELECT", "INSERT", "UPDATE", "DELETE"):
        assert f"FOR {op}" in sql, f"{table} has no {op} policy"


@pytest.mark.parametrize("table", sorted(_orm_tenant_tables())[:12])
def test_write_policies_carry_with_check(table):
    """WITH CHECK is what stops a row being written into another tenant.

    A USING clause alone would let an UPDATE move a row across tenants, since
    USING only decides which rows may be touched, not what they may become.
    """
    statements = policy_statements_for_table(table)
    insert = next(s for s in statements if "FOR INSERT" in s)
    update = next(s for s in statements if "FOR UPDATE" in s)
    assert "WITH CHECK" in insert
    assert "USING" in update and "WITH CHECK" in update


def test_unset_tenant_yields_no_rows_rather_than_an_error():
    """Policies must use the non-raising two-argument current_setting.

    Single-argument current_setting raises undefined_object when the variable
    was never set, which would turn any missing tenant context into a 500 on
    every query rather than an empty result.
    """
    sql = " ".join(rls_setup_sql())
    setting = settings.TENANT_RLS_SETTING_NAME
    assert f"current_setting('{setting}', true)" in sql
    bare = re.findall(rf"current_setting\('{re.escape(setting)}'\s*\)", sql)
    assert not bare, (
        "found single-argument current_setting; an unset tenant would raise "
        "instead of returning no rows"
    )


def test_policies_compare_against_account_id():
    for statement in rls_setup_sql():
        if "CREATE POLICY" in statement:
            assert "account_id =" in statement


def test_setup_is_idempotent():
    """Re-running setup must not fail on already-existing policies."""
    creates = [s for s in rls_setup_sql() if "CREATE POLICY" in s]
    drops = [s for s in rls_setup_sql() if "DROP POLICY IF EXISTS" in s]
    assert len(drops) == len(creates), (
        "every CREATE POLICY needs a matching DROP POLICY IF EXISTS before it, "
        "or a second run fails on duplicates"
    )


def test_teardown_reverses_setup():
    table = sorted(_orm_tenant_tables())[0]
    sql = " ".join(disable_statements_for_table(table))
    assert "NO FORCE ROW LEVEL SECURITY" in sql
    assert "DISABLE ROW LEVEL SECURITY" in sql
    for op in ("select", "insert", "update", "delete"):
        assert f"{table}_tenant_{op}" in sql


def test_no_sql_injection_surface_in_generated_names():
    """Table names come from ORM metadata, but assert they stay identifier-safe."""
    for table in tenant_tables():
        assert re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table), (
            f"table name {table!r} is not a bare identifier and would need quoting"
        )
