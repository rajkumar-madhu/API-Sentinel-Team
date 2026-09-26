"""The RLS tenant hook must key off the live connection's dialect, not DATABASE_URL."""

from types import SimpleNamespace

import pytest

from server.config import settings
from server.modules.persistence.database import _apply_tenant_context_on_begin
from server.modules.tenancy.context import set_current_account_id


class _RecordingConnection:
    def __init__(self, dialect_name: str):
        self.dialect = SimpleNamespace(name=dialect_name)
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append((str(statement), params))


@pytest.fixture
def rls_on_with_postgres_url(monkeypatch):
    monkeypatch.setattr(settings, "TENANT_RLS_ENABLED", True)
    monkeypatch.setattr(settings, "DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")
    set_current_account_id(1000000)
    yield
    set_current_account_id(None)


def test_sqlite_connection_gets_no_set_local_even_with_postgres_url(rls_on_with_postgres_url):
    connection = _RecordingConnection("sqlite")

    _apply_tenant_context_on_begin(None, None, connection)

    assert connection.statements == []


def test_postgres_connection_gets_tenant_set_local(rls_on_with_postgres_url):
    connection = _RecordingConnection("postgresql")

    _apply_tenant_context_on_begin(None, None, connection)

    assert len(connection.statements) == 1
    sql, params = connection.statements[0]
    assert sql.startswith(f"SET LOCAL {settings.TENANT_RLS_SETTING_NAME}")
    assert params == {"account_id": "1000000"}


def test_no_set_local_without_tenant(monkeypatch):
    monkeypatch.setattr(settings, "TENANT_RLS_ENABLED", True)
    set_current_account_id(None)
    connection = _RecordingConnection("postgresql")

    _apply_tenant_context_on_begin(None, None, connection)

    assert connection.statements == []
