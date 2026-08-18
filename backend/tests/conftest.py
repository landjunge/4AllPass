import os
from collections.abc import AsyncIterator

import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

TEST_DATABASE_URL = os.environ.get(
    "FOURALLPASS_TEST_DATABASE_URL",
    "postgresql+asyncpg://fourallpass:fourallpass@localhost:5432/fourallpass_test",
)
os.environ.setdefault("FOURALLPASS_DATABASE_URL", TEST_DATABASE_URL)

# A dedicated Redis database, flushed per test: the auth tests assert on token
# state, so they must not see anything a previous test or a dev server left.
TEST_REDIS_URL = os.environ.get(
    "FOURALLPASS_TEST_REDIS_URL", "redis://localhost:6379/15"
)
os.environ.setdefault("FOURALLPASS_REDIS_URL", TEST_REDIS_URL)

from app.db.base import Base  # noqa: E402


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
        # `expire_on_commit=False` mirrors the application's sessionmaker
        # (app/db/session.py): a test must exercise the same post-commit
        # attribute behaviour the routes see, not a stricter one.
        session = AsyncSession(
            bind=conn,
            join_transaction_mode="create_savepoint",
            expire_on_commit=False,
        )
        try:
            yield session
        finally:
            await session.close()
            await conn.rollback()


@pytest_asyncio.fixture(loop_scope="session")
async def redis_client():
    """Flushed Redis client on the test database."""
    from redis.asyncio import Redis

    client = Redis.from_url(TEST_REDIS_URL, decode_responses=True)
    await client.flushdb()
    try:
        yield client
    finally:
        await client.flushdb()
        await client.aclose()


@pytest_asyncio.fixture(loop_scope="session")
async def api_client(db_session, redis_client):
    """HTTP client whose requests run inside the test transaction.

    `get_db` and `get_redis` are overridden so the API and the test see the same
    data: the API's own `commit()` releases a savepoint, and the outer
    transaction is still rolled back when the test ends.
    """
    from httpx import ASGITransport, AsyncClient

    from app.api.deps import get_db, get_redis
    from app.main import app

    async def _override_db() -> AsyncIterator[AsyncSession]:
        yield db_session

    async def _override_redis():
        yield redis_client

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_redis] = _override_redis
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        try:
            yield client
        finally:
            app.dependency_overrides.pop(get_db, None)
            app.dependency_overrides.pop(get_redis, None)
