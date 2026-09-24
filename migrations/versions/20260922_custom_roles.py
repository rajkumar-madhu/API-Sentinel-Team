"""Add custom_roles table for per-account custom RBAC roles.

Revision ID: 20260922_custom_roles
Revises: 20260815_request_log_host
Create Date: 2026-09-22 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260922_custom_roles"
down_revision = "20260815_request_log_host"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    return sa.inspect(bind).has_table(table_name)


def upgrade() -> None:
    if _has_table("custom_roles"):
        return
    op.create_table(
        "custom_roles",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("permissions", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("account_id", "name", name="uq_custom_roles_account_name"),
    )
    op.create_index("ix_custom_roles_account_id", "custom_roles", ["account_id"])


def downgrade() -> None:
    if not _has_table("custom_roles"):
        return
    op.drop_index("ix_custom_roles_account_id", table_name="custom_roles")
    op.drop_table("custom_roles")
