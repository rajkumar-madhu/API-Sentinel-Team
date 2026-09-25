"""Unique (account_id, provider) on oauth_providers.

The authorize/callback/login routes resolve one provider per type per account
with scalar_one_or_none(), so duplicates break sign-in for that type.

Revision ID: 20260925_oauth_provider_unique
Revises: 20260922_oauth_provider_config
Create Date: 2026-09-25 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260925_oauth_provider_unique"
down_revision = "20260922_oauth_provider_config"
branch_labels = None
depends_on = None

INDEX_NAME = "uq_oauth_providers_account_provider"


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(table_name)


def _has_index(table_name: str, index_name: str) -> bool:
    bind = op.get_bind()
    return any(index["name"] == index_name for index in sa.inspect(bind).get_indexes(table_name))


def upgrade() -> None:
    if not _has_table("oauth_providers") or _has_index("oauth_providers", INDEX_NAME):
        return
    duplicates = op.get_bind().execute(
        sa.text(
            "SELECT account_id, provider, COUNT(*) FROM oauth_providers "
            "GROUP BY account_id, provider HAVING COUNT(*) > 1"
        )
    ).fetchall()
    if duplicates:
        listed = ", ".join(f"account {row[0]} / {row[1]} ({row[2]} rows)" for row in duplicates)
        raise RuntimeError(
            "oauth_providers has duplicate (account_id, provider) rows: "
            f"{listed}. Delete the extra rows, then re-run the migration."
        )
    op.create_index(INDEX_NAME, "oauth_providers", ["account_id", "provider"], unique=True)


def downgrade() -> None:
    if not _has_table("oauth_providers") or not _has_index("oauth_providers", INDEX_NAME):
        return
    op.drop_index(INDEX_NAME, table_name="oauth_providers")
