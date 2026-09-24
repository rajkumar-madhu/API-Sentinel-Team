"""
PostgreSQL Row-Level Security (RLS) enforcement for multi-tenant isolation.

Enforces account_id-based access control at the database level.
This module provides SQL statements for enabling RLS on all multi-tenant tables.

IMPORTANT: RLS is only available in PostgreSQL. SQLite does not support RLS.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import logging

logger = logging.getLogger(__name__)

# Every table in server/models/core.py that carries an account_id column.
# Keep this in sync when a new multi-tenant table is added — a table left out
# here has no database-level tenant isolation backstop, only the per-router
# application-level filter.
RLS_TENANT_TABLES = [
    "api_endpoints", "test_accounts", "auth_profiles", "pentest_profiles",
    "pentest_artifacts", "vulnerabilities", "test_runs", "sample_data",
    "auth_mechanisms", "test_schedules", "request_logs", "waf_events",
    "threat_actors", "malicious_events", "api_collections", "account_settings",
    "users", "api_tokens", "integrations", "audit_logs", "ingestion_jobs",
    "ingestion_dead_letters", "endpoint_revisions", "openapi_specs",
    "policy_violations", "tenant_retention_policies", "response_playbooks",
    "response_action_logs", "sensitive_data_findings", "evidence_records",
    "evidence_packages", "governance_rules", "malicious_event_records",
    "agentic_sessions", "endpoint_metrics_hourly", "actor_metrics_hourly",
    "alert_metrics_daily", "external_recon_findings", "recon_sources",
    "agent_identities", "mcp_tool_invocations", "agentic_violations",
    "threat_configs", "source_code_repos", "source_code_findings",
    "nuclei_scans", "nuclei_templates", "api_workflows", "api_workflow_runs",
    "cicd_triggers", "billing_subscriptions", "mcp_endpoints",
    "oauth_providers", "blocked_ips", "endpoint_blocks", "rate_limit_overrides",
    "alerts", "ml_models", "ml_model_runs", "ml_model_evaluations",
    "feature_vectors", "actor_profiles", "actor_baselines",
    "detection_object_states", "business_logic_graphs",
    "business_logic_violations", "sensors", "custom_roles",
]

# warm_export_cursors and jwt_revoked_tokens are intentionally excluded:
# WarmExportCursor allows account_id == 0 (a sentinel, not a tenant) per the
# before_flush validator in database.py, and revoked-token lookups must work
# across accounts during token verification (before the caller's own tenant
# is known), so scoping either by RLS would break existing behavior.


def _account_isolation_policies(table_name: str) -> list[str]:
    """Idempotent ENABLE + CREATE POLICY statements for one account_id-scoped table."""
    policies = [
        ("account_isolation", "SELECT", "USING"),
        ("insert_isolation", "INSERT", "WITH CHECK"),
        ("update_isolation", "UPDATE", "USING AND WITH CHECK"),
        ("delete_isolation", "DELETE", "USING"),
    ]
    statements = [f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;"]
    condition = f"account_id = current_setting('app.current_account_id')::bigint"
    for suffix, action, clause in policies:
        policy_name = f"{table_name}_{suffix}"
        statements.append(f"DROP POLICY IF EXISTS {policy_name} ON {table_name};")
        if clause == "USING":
            body = f"USING ({condition})"
        elif clause == "WITH CHECK":
            body = f"WITH CHECK ({condition})"
        else:
            body = f"USING ({condition}) WITH CHECK ({condition})"
        statements.append(
            f"CREATE POLICY {policy_name} ON {table_name} FOR {action} {body};"
        )
    return statements


RLS_SETUP_STATEMENTS = {table: _account_isolation_policies(table) for table in RLS_TENANT_TABLES}


async def enable_rls_on_all_tables(db: AsyncSession) -> dict:
    """
    Enable Row-Level Security on all multi-tenant tables.
    Sets up policies that enforce account_id-based isolation.

    Idempotent: safe to call on every startup (DROP POLICY IF EXISTS precedes
    each CREATE POLICY, and re-enabling RLS on an already-enabled table is a
    Postgres no-op).

    Returns: dict with success/failure status for each table
    """
    results = {}

    for table_name, statements in RLS_SETUP_STATEMENTS.items():
        try:
            for statement in statements:
                if statement.strip():
                    await db.execute(text(statement))
            await db.commit()
            results[table_name] = {"status": "success", "message": "RLS enabled"}
            logger.info(f"rls_enabled_table: {table_name}")
        except Exception as e:
            results[table_name] = {"status": "error", "message": str(e)}
            logger.error(f"rls_setup_failed_table: {table_name}, error: {str(e)}")
            await db.rollback()

    return results


async def set_current_account_id(db: AsyncSession, account_id: int) -> None:
    """
    Set the current account_id in the PostgreSQL session.
    This is used by RLS policies to filter rows.

    Must be called before querying to enforce RLS filtering.
    """
    try:
        await db.execute(
            text(f"SET app.current_account_id = {account_id}")
        )
    except Exception as e:
        logger.warning(f"Failed to set current_account_id: {e}")


async def disable_rls_on_all_tables(db: AsyncSession) -> dict:
    """Disable RLS on all tables (use for testing or migration)."""
    results = {}

    for table_name in RLS_TENANT_TABLES:
        try:
            await db.execute(text(f"ALTER TABLE {table_name} DISABLE ROW LEVEL SECURITY;"))
            policies = [
                f"{table_name}_account_isolation",
                f"{table_name}_insert_isolation",
                f"{table_name}_update_isolation",
                f"{table_name}_delete_isolation",
            ]
            for policy in policies:
                try:
                    await db.execute(text(f"DROP POLICY IF EXISTS {policy} ON {table_name};"))
                except Exception:
                    pass

            await db.commit()
            results[table_name] = {"status": "success"}
        except Exception as e:
            results[table_name] = {"status": "error", "message": str(e)}
            logger.error(f"rls_disable_failed: {table_name}, error: {str(e)}")
            await db.rollback()

    return results
