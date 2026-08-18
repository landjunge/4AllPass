import os
from collections.abc import AsyncIterator, Callable

import pytest
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
from app.core.sessions import get_session_store  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.main import app  # noqa: E402

get_settings.cache_clear()


@pytest.fixture(autouse=True)
def isolated_rate_limits():
    """Give every test a fresh login/register rate-limit budget."""
    store = get_session_store()
    clear = getattr(store, "clear_rate_limits", None)
    if clear is not None:
        clear()
    yield


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
async def client_factory(engine) -> AsyncIterator[Callable[[], AsyncClient]]:
    """Build API clients that do **not** share a cookie jar.

    Cookie sessions are per-browser, so any test about who is authenticated
    has to be able to model two separate browsers — and an anonymous one.
    Reusing a single client would silently carry the last account's session
    cookie into a request that is meant to be unauthenticated, and the test
    would pass for the wrong reason.
    """
    factory = async_sessionmaker(
        bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )

    async def override_get_db() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    opened: list[AsyncClient] = []

    def make() -> AsyncClient:
        created = AsyncClient(transport=transport, base_url="http://test")
        opened.append(created)
        return created

    try:
        yield make
    finally:
        for created in opened:
            await created.aclose()
        app.dependency_overrides.clear()


@pytest_asyncio.fixture(loop_scope="session")
async def client(client_factory) -> AsyncIterator[AsyncClient]:
    yield client_factory()


@pytest_asyncio.fixture(loop_scope="session")
async def anonymous_client(client_factory) -> AsyncIterator[AsyncClient]:
    """A client that has never authenticated and holds no cookies."""
    yield client_factory()
