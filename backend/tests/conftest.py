import os
from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

TEST_DATABASE_URL = os.environ.get(
    "FOURALLPASS_TEST_DATABASE_URL",
    "postgresql+asyncpg://fourallpass:fourallpass@localhost:5432/fourallpass_test",
)
os.environ.setdefault("FOURALLPASS_DATABASE_URL", TEST_DATABASE_URL)

from app.api.deps import get_db  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.redis import get_redis_client  # noqa: E402
from app.main import app  # noqa: E402


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


@pytest_asyncio.fixture(loop_scope="session", autouse=True)
async def clean_redis():
    """Flush Redis before and after each test."""
    redis = get_redis_client()
    try:
        await redis.flushdb()
    except Exception:
        pass
    yield
    try:
        await redis.flushdb()
    except Exception:
        pass


@pytest_asyncio.fixture(loop_scope="session")
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """FastAPI test client with database dependency override."""
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
