from sqlalchemy import event, inspect, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import Session
from server.config import settings
from server.modules.tenancy.context import get_current_account_id

_engine_kwargs = {
    "echo": False,
    "future": True,
    "pool_pre_ping": True,
}

if not settings.DATABASE_URL.startswith("sqlite"):
    _engine_kwargs.update({
        "pool_size": settings.DB_POOL_SIZE,
        "max_overflow": settings.DB_MAX_OVERFLOW,
        "pool_timeout": settings.DB_POOL_TIMEOUT,
        "pool_recycle": settings.DB_POOL_RECYCLE,
    })

engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)

_read_engine = None
if settings.READ_REPLICA_URL:
    _read_engine = create_async_engine(settings.READ_REPLICA_URL, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)

ReadOnlySessionLocal = async_sessionmaker(
    bind=_read_engine or engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


def _validate_account_scoped_models(session: Session, flush_context, instances) -> None:
    for obj in list(session.new) + list(session.dirty):
        if obj in session.deleted:
            continue

        mapper = inspect(obj).mapper
        if "account_id" not in mapper.columns:
            continue

        account_id = getattr(obj, "account_id", None)
        cls_name = obj.__class__.__name__

        if cls_name == "WarmExportCursor":
            if account_id is None or int(account_id) < 0:
                raise ValueError(f"{cls_name}.account_id must be >= 0")
            continue

        if account_id is None:
            raise ValueError(f"{cls_name}.account_id is required")
        if int(account_id) <= 0:
            raise ValueError(f"{cls_name}.account_id must be > 0")


event.listen(Session, "before_flush", _validate_account_scoped_models)

async def get_db():
    async with AsyncSessionLocal() as session:
        await apply_tenant_context(session)
        yield session

async def get_read_db():
    async with ReadOnlySessionLocal() as session:
        await apply_tenant_context(session)
        yield session


async def apply_tenant_context(session) -> None:
    """Stamp the tenant onto the DB session so RLS policies can see it.

    Two things here are load-bearing and easy to get wrong:

    ``SET LOCAL`` only survives inside a transaction -- outside one Postgres
    warns and discards it -- so the transaction is started explicitly first.
    Scoping to the transaction is the point: the value must not outlive this
    request on a pooled connection and leak into the next tenant's queries.

    This runs when the session is created, which is *before* the auth dependency
    has necessarily resolved, so the tenant may not be known yet. That is why
    ``ensure_tenant_context`` exists and why the policies treat an unset tenant
    as "no rows" rather than raising.
    """
    if not settings.TENANT_RLS_ENABLED:
        return
    if "postgres" not in settings.DATABASE_URL:
        return
    account_id = get_current_account_id()
    if account_id is None:
        return
    await session.begin()
    await session.execute(
        text(f"SET LOCAL {settings.TENANT_RLS_SETTING_NAME} = :account_id"),
        {"account_id": str(int(account_id))},
    )


async def ensure_tenant_context(session) -> None:
    """Re-stamp the tenant if it became known after the session was opened.

    FastAPI resolves dependencies in declaration order, so a route that declares
    ``db`` before its auth dependency opens the session while the tenant
    contextvar is still empty. Calling this once the tenant is known closes that
    window. Safe to call repeatedly; a no-op when RLS is off, when the backend
    is not Postgres, or when no tenant is set.
    """
    await apply_tenant_context(session)
