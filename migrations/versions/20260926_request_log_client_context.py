"""Client context: request_logs (client_ip, user_agent, client_id), audit_logs.user_agent.

Revision ID: 20260926_request_log_client_context
Revises: 20260925_oauth_provider_unique
Create Date: 2026-09-26 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260926_request_log_client_context"
down_revision = "20260925_oauth_provider_unique"
branch_labels = None
depends_on = None

_COLUMNS = (
    ("client_ip", sa.String(45)),
    ("user_agent", sa.String(512)),
    ("client_id", sa.String(128)),
)


def _existing_columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(table):
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def upgrade() -> None:
    existing = _existing_columns("request_logs")
    if existing:
        for name, column_type in _COLUMNS:
            if name not in existing:
                op.add_column("request_logs", sa.Column(name, column_type, nullable=True))
    audit = _existing_columns("audit_logs")
    if audit and "user_agent" not in audit:
        op.add_column("audit_logs", sa.Column("user_agent", sa.String(512), nullable=True))


def downgrade() -> None:
    if "user_agent" in _existing_columns("audit_logs"):
        op.drop_column("audit_logs", "user_agent")
    existing = _existing_columns("request_logs")
    for name, _ in reversed(_COLUMNS):
        if name in existing:
            op.drop_column("request_logs", name)
