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

# Argon2id at production cost would put ~100 ms on every register and login in
# a suite that does dozens of both. These are the *server's account password*
# parameters only; nothing in the vault KDF is affected, and the production
# defaults live in app/core/config.py.
os.environ.setdefault("FOURALLPASS_PASSWORD_HASH_TIME_COST", "1")
os.environ.setdefault("FOURALLPASS_PASSWORD_HASH_MEMORY_COST_KIB", "512")
os.environ.setdefault("FOURALLPASS_PASSWORD_HASH_PARALLELISM", "1")

from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402

# A dotted host, so `http.cookiejar` stores response cookies under exactly this
# domain. With a single-label host it would append `.local` itself, and a test
# that plants a cookie by hand would end up with two entries of the same name.
BASE_URL = "http://testserver.local"


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
    """Function-scoped session, isolated in a rolled-back transaction.

    ``expire_on_commit=False`` mirrors ``AsyncSessionLocal``: a route that
    commits and then reads an attribute must behave here exactly as it does in
    production, where a lazy refresh would be an error rather than a query.
    """
    async with engine.connect() as conn:
        await conn.begin()
        session = AsyncSession(
            bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
        )
        try:
            yield session
        finally:
            await session.close()
            await conn.rollback()


@pytest_asyncio.fixture(loop_scope="session")
async def api_app(db_session) -> AsyncIterator[object]:
    """The real app, with its database dependency pointed at the rolled-back session.

    Only ``get_db`` is overridden. Authentication, authorization, the session
    store and the origin check all run exactly as they do in production —
    substituting any of them would test the substitute.
    """

    async def _get_db_override() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _get_db_override
    try:
        yield app
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest_asyncio.fixture(loop_scope="session")
async def client(api_app) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=api_app), base_url=BASE_URL) as http_client:
        yield http_client


@pytest_asyncio.fixture(loop_scope="session")
async def other_client(api_app) -> AsyncIterator[AsyncClient]:
    """A second browser, with its own cookie jar, talking to the same server."""
    async with AsyncClient(transport=ASGITransport(app=api_app), base_url=BASE_URL) as http_client:
        yield http_client


@pytest_asyncio.fixture(loop_scope="session")
async def anonymous_client(api_app) -> AsyncIterator[AsyncClient]:
    """A client that never logs in."""
    async with AsyncClient(transport=ASGITransport(app=api_app), base_url=BASE_URL) as http_client:
        yield http_client
