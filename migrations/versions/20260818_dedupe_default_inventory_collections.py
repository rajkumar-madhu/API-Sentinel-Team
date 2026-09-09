"""Repair and constrain per-account default inventory collections.

Revision ID: 20260818_dedupe_default_inventory_collections
Revises: 20260817_request_log_evidence
Create Date: 2026-08-18 05:25:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260818_dedupe_default_inventory_collections"
down_revision = "20260817_request_log_evidence"
branch_labels = None
depends_on = None

_DEFAULT_NAME = "Default Inventory"
_INDEX_NAME = "uq_api_collections_default_inventory_account"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("api_collections"):
        return

    # Keep the oldest collection per tenant (created_at, then id) — same order
    # the ingest path uses. UUID PKs make MIN(id) lexicographic, not oldest.
    duplicate_accounts = bind.execute(
        sa.text(
            """
            SELECT account_id
            FROM api_collections
            WHERE name = :name
            GROUP BY account_id
            HAVING COUNT(*) > 1
            """
        ),
        {"name": _DEFAULT_NAME},
    ).scalars()

    for account_id in duplicate_accounts:
        keep_id = bind.execute(
            sa.text(
                """
                SELECT id
                FROM api_collections
                WHERE account_id = :account_id
                  AND name = :name
                ORDER BY created_at ASC, id ASC
                LIMIT 1
                """
            ),
            {"account_id": account_id, "name": _DEFAULT_NAME},
        ).scalar()
        if not keep_id:
            continue

        duplicate_ids = bind.execute(
            sa.text(
                """
                SELECT id
                FROM api_collections
                WHERE account_id = :account_id
                  AND name = :name
                  AND id <> :keep_id
                """
            ),
            {
                "account_id": account_id,
                "name": _DEFAULT_NAME,
                "keep_id": keep_id,
            },
        ).scalars()
        for duplicate_id in duplicate_ids:
            if inspector.has_table("api_endpoints"):
                bind.execute(
                    sa.text(
                        """
                        UPDATE api_endpoints
                        SET collection_id = :keep_id
                        WHERE collection_id = :duplicate_id
                        """
                    ),
                    {"keep_id": keep_id, "duplicate_id": duplicate_id},
                )
            bind.execute(
                sa.text("DELETE FROM api_collections WHERE id = :duplicate_id"),
                {"duplicate_id": duplicate_id},
            )

    dialect = bind.dialect.name
    if dialect in {"postgresql", "sqlite"}:
        where = sa.text("name = 'Default Inventory'")
        op.create_index(
            _INDEX_NAME,
            "api_collections",
            ["account_id"],
            unique=True,
            **({"postgresql_where": where} if dialect == "postgresql" else {"sqlite_where": where}),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("api_collections"):
        op.drop_index(_INDEX_NAME, table_name="api_collections")
