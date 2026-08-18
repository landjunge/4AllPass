import os
from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

TEST_DATABASE_URL = os.environ.get(
    "FOURALLPASS_TEST_DATABASE_URL",
    "postgresql+asyncpg://fourallpass:fourallpass@localhost:5432/fourallpass_test",
)
os.environ.setdefault("FOURALLPASS_DATABASE_URL", TEST_DATABASE_URL)
os.environ.setdefault("FOURALLPASS_SESSION_BACKEND", "memory")
os.environ.setdefault("FOURALLPASS_SESSION_SECRET", "test-session-secret")

from app.api.deps import get_db  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.sessions import reset_memory_store  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.main import app  # noqa: E402

get_settings.cache_clear()

SESSION_COOKIE = "fourallpass_session"


def use_session(client: AsyncClient, token: str) -> AsyncClient:
    """Bind the account session cookie on the client (not per-request)."""
    client.cookies.clear()
    client.cookies.set(SESSION_COOKIE, token)
    return client


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL, future=True)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await eng.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def db_session(engine) -> AsyncIterator[AsyncSession]:
    """Function-scoped session, isolated in a rolled-back transaction."""
    async with engine.connect() as conn:
        await conn.begin()
        session = AsyncSession(bind=conn, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            await session.close()
            await conn.rollback()


@pytest_asyncio.fixture(loop_scope="session")
async def client(engine) -> AsyncIterator[AsyncClient]:
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)

    async def override_get_db() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    reset_memory_store()
    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
    reset_memory_store()
