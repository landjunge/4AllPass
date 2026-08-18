import os
import uuid
from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

TEST_DATABASE_URL = os.environ.get(
    "FOURALLPASS_TEST_DATABASE_URL",
    "postgresql+asyncpg://fourallpass:fourallpass@localhost:5432/fourallpass_test",
)
os.environ.setdefault("FOURALLPASS_DATABASE_URL", TEST_DATABASE_URL)

from app.db.base import Base  # noqa: E402
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


def make_api_client() -> AsyncClient:
    """A fresh in-process API client with its own cookie jar."""
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def unique_email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}@example.com"


@pytest_asyncio.fixture(loop_scope="session")
async def api_client(engine) -> AsyncIterator[AsyncClient]:
    """Unauthenticated API client; `engine` guarantees tables exist."""
    async with make_api_client() as client:
        yield client


async def register_and_login(
    client: AsyncClient, *, email: str | None = None, password: str = "correct horse battery"
) -> dict:
    """Register a fresh account and establish a session on `client`."""
    email = email or unique_email()
    register = await client.post("/auth/register", json={"email": email, "password": password})
    assert register.status_code == 201, register.text
    login = await client.post("/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200, login.text
    user = login.json()
    user["password"] = password
    return user


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
