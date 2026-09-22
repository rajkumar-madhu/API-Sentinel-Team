"""Add config JSON column to oauth_providers for generic OIDC/SAML settings.

Revision ID: 20260922_oauth_provider_config
Revises: 20260922_custom_roles
Create Date: 2026-09-22 00:05:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260922_oauth_provider_config"
down_revision = "20260922_custom_roles"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(table_name)


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    return any(
        column["name"] == column_name
        for column in sa.inspect(bind).get_columns(table_name)
    )


def upgrade() -> None:
    if not _has_table("oauth_providers"):
        return
    if _has_column("oauth_providers", "config"):
        return
    op.add_column("oauth_providers", sa.Column("config", sa.JSON(), nullable=True))


def downgrade() -> None:
    if not _has_table("oauth_providers"):
        return
    if not _has_column("oauth_providers", "config"):
        return
    op.drop_column("oauth_providers", "config")
