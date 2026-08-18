import base64
import os
import secrets
from collections.abc import AsyncIterator, Iterator
from typing import Any

os.environ.setdefault(
    "FOURALLPASS_DATABASE_URL",
    "postgresql+asyncpg://4allpass:4allpass@localhost:5432/4allpass_test",
)
os.environ.setdefault("FOURALLPASS_REDIS_URL", "redis://localhost:6379/1")
os.environ.setdefault("FOURALLPASS_ENVIRONMENT", "test")

import pytest
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from alembic import command
from app.config import get_settings
from app.db import dispose_engine, get_sessionmaker
from app.main import create_app
from app.redis_client import close_redis, get_redis

BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TABLES = [
    "device_key_envelopes",
    "webauthn_credentials",
    "devices",
    "encrypted_entries",
    "key_envelopes",
    "vault_snapshots",
    "vaults",
    "account_identities",
    "accounts",
]


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> Iterator[None]:
    settings = get_settings()
    config = Config(os.path.join(BACKEND_ROOT, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND_ROOT, "alembic"))
    config.set_main_option("sqlalchemy.url", settings.sync_database_url)
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    yield


@pytest.fixture(autouse=True)
async def clean_state() -> AsyncIterator[None]:
    async with get_sessionmaker()() as session:
        await session.execute(text(f"TRUNCATE {', '.join(TABLES)} CASCADE"))
        await session.commit()
    await get_redis().flushdb()
    yield


@pytest.fixture(scope="session", autouse=True)
async def shutdown() -> AsyncIterator[None]:
    yield
    await dispose_engine()
    await close_redis()


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    app = create_app(get_settings())
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


@pytest.fixture
async def db_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        yield session


@pytest.fixture
def api() -> str:
    return get_settings().api_prefix


class Api:
    """Thin helper so tests read like the client flow, not like HTTP plumbing."""

    def __init__(self, http: AsyncClient, prefix: str) -> None:
        self.http = http
        self.prefix = prefix
        self.token: str | None = None

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    async def register(
        self, email: str | None = None, password: str = "correct-horse-battery"
    ) -> Any:
        email = email or f"user_{secrets.token_hex(6)}@example.com"
        response = await self.http.post(
            f"{self.prefix}/auth/register", json={"email": email, "password": password}
        )
        if response.status_code == 201:
            self.token = response.json()["token"]
        return response

    async def login(self, email: str, password: str) -> Any:
        response = await self.http.post(
            f"{self.prefix}/auth/login", json={"email": email, "password": password}
        )
        if response.status_code == 200:
            self.token = response.json()["token"]
        return response

    async def get(self, path: str) -> Any:
        return await self.http.get(f"{self.prefix}{path}", headers=self._headers())

    async def post(self, path: str, json: Any = None) -> Any:
        return await self.http.post(f"{self.prefix}{path}", json=json, headers=self._headers())

    async def put(self, path: str, json: Any = None) -> Any:
        return await self.http.put(f"{self.prefix}{path}", json=json, headers=self._headers())

    async def delete(self, path: str) -> Any:
        return await self.http.delete(f"{self.prefix}{path}", headers=self._headers())


@pytest.fixture
async def anonymous(client: AsyncClient, api: str) -> Api:
    return Api(client, api)


@pytest.fixture
async def account(client: AsyncClient, api: str) -> Api:
    caller = Api(client, api)
    response = await caller.register()
    assert response.status_code == 201, response.text
    return caller


@pytest.fixture
async def vault_id(account: Api) -> str:
    response = await account.post("/vaults")
    assert response.status_code == 201, response.text
    return response.json()["vaultId"]


def b64(length: int) -> str:
    """Random bytes of the exact length the protocol requires."""
    return base64.b64encode(secrets.token_bytes(length)).decode()


def master_envelope(**overrides: Any) -> dict[str, Any]:
    envelope = {
        "version": 1,
        "type": "master",
        "vaultKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": b64(12),
        "ciphertext": b64(32),
        "tag": b64(16),
        "kdf": {
            "algorithm": "argon2id",
            "version": 19,
            "memory": 65536,
            "iterations": 3,
            "parallelism": 4,
            "hashLen": 32,
            "salt": b64(16),
        },
    }
    envelope.update(overrides)
    return envelope


def device_envelope(device_id: str, **overrides: Any) -> dict[str, Any]:
    envelope = {
        "version": 1,
        "type": "device",
        "vaultKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "deviceId": device_id,
        "deviceKeyVersion": 1,
        "nonce": b64(12),
        "ciphertext": b64(32),
        "tag": b64(16),
    }
    envelope.update(overrides)
    return envelope


def recovery_envelope(**overrides: Any) -> dict[str, Any]:
    envelope = {
        "version": 1,
        "type": "recovery",
        "vaultKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": b64(12),
        "ciphertext": b64(32),
        "tag": b64(16),
    }
    envelope.update(overrides)
    return envelope


def entry(entry_id: str, **overrides: Any) -> dict[str, Any]:
    payload = {
        "id": entry_id,
        "schemaVersion": 1,
        "cryptoVersion": 1,
        "vaultKeyVersion": 1,
        "nonce": b64(12),
        "ciphertext": b64(64),
        "tag": b64(16),
    }
    payload.update(overrides)
    return payload


def snapshot(
    revision: int = 1,
    vault_key_version: int = 1,
    expected_revision: int | None = None,
    envelopes: list[dict[str, Any]] | None = None,
    entries: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "revision": revision,
        "vaultKeyVersion": vault_key_version,
        "cryptoProtocolVersion": 1,
        # Default records carry the snapshot's own VK generation, because the
        # API refuses mixed-generation snapshots.
        "envelopes": envelopes
        if envelopes is not None
        else [
            master_envelope(vaultKeyVersion=vault_key_version),
            recovery_envelope(vaultKeyVersion=vault_key_version),
        ],
        "entries": entries if entries is not None else [],
    }
    if expected_revision is not None:
        payload["expectedRevision"] = expected_revision
    return payload
