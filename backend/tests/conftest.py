import os
import tempfile
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


def _default_sqlite_url() -> str:
    handle = tempfile.NamedTemporaryFile(prefix="fourallpass-test-", suffix=".db", delete=False)
    handle.close()
    return f"sqlite+aiosqlite:///{handle.name}"


TEST_DATABASE_URL = os.environ.get("FOURALLPASS_TEST_DATABASE_URL", _default_sqlite_url())
os.environ.setdefault("FOURALLPASS_DATABASE_URL", TEST_DATABASE_URL)
os.environ.setdefault("FOURALLPASS_SESSION_BACKEND", "memory")
os.environ.setdefault("FOURALLPASS_SESSION_SECRET", "test-session-secret")

from app.api.deps import get_db  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import create_db_engine  # noqa: E402
from app.main import app  # noqa: E402

get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _reset_memory_session_store():
    from app.core.sessions import get_session_store

    store = get_session_store()
    reset = getattr(store, "reset", None)
    if callable(reset):
        reset()
    yield


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def engine():
    eng = create_db_engine(TEST_DATABASE_URL)
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


TEST_DEVICE_ID = "dev_sessiontestdevice0000001"


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

    async def _attach_device(request):
        if "x-device-id" not in {k.lower() for k in request.headers}:
            request.headers["X-Device-Id"] = TEST_DEVICE_ID

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        event_hooks={"request": [_attach_device]},
    ) as ac:
        yield ac
    app.dependency_overrides.clear()
