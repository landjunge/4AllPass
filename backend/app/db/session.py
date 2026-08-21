from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def engine_kwargs(url: str) -> dict:
    """Dialect-specific engine options. SQLite busy timeout matches the
    writer-serialization window in docs/security-boundary.md §5.
    """
    if url.startswith("sqlite"):
        return {"future": True, "connect_args": {"timeout": 30.0}}
    return {"future": True, "pool_pre_ping": True}


def configure_engine(engine: AsyncEngine) -> None:
    """SQLite: ``BEGIN IMMEDIATE`` so writers serialize like Postgres
    ``SELECT … FOR UPDATE``. Does not touch envelope bytes.
    """
    if engine.dialect.name != "sqlite":
        return

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_connect(dbapi_connection, _record) -> None:  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
        finally:
            cursor.close()

    @event.listens_for(engine.sync_engine, "begin")
    def _sqlite_begin(conn) -> None:  # noqa: ANN001
        conn.exec_driver_sql("BEGIN IMMEDIATE")


def create_db_engine(url: str) -> AsyncEngine:
    engine = create_async_engine(url, **engine_kwargs(url))
    configure_engine(engine)
    return engine


def reset_engine() -> None:
    """Drop the process-wide engine so a later ``get_engine`` reads settings again.

    Used by the local profile entrypoint after it writes env vars.
    """
    global _engine, _session_factory
    _engine = None
    _session_factory = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_db_engine(get_settings().database_url)
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )
    return _session_factory


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency yielding a request-scoped database session."""
    async with get_session_factory()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
