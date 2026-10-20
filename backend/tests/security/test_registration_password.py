"""H1 route/schema acceptance with no database or external service side effects.

The HTTP fixture uses the real application/schema/routes with replacement
adapters. Separate cases verify existing hashes and the real UTF-8 Argon2 path.
"""
import json
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.api import deps
from app.api.routes import auth
from app.core.security import hash_account_password, verify_account_password
from app.main import create_app
from app.models.user import User


class Database:
    def __init__(self):
        self.existing = None
        self.added = []

    async def execute(self, statement):
        return self

    def scalar_one_or_none(self):
        return self.existing

    def add(self, user):
        self.added.append(user)

    async def flush(self):
        for user in self.added:
            user.id = uuid.uuid4()


class Sessions:
    async def put(self, *args):
        pass


@pytest_asyncio.fixture
async def isolated_api(monkeypatch):
    database, hashed = Database(), []

    async def get_db():
        yield database

    async def no_rate_side_effect(*args):
        pass

    def record_hash(password):
        hashed.append(password)
        return "synthetic-h1-hash"

    app = create_app()
    app.dependency_overrides[deps.get_db] = get_db
    app.dependency_overrides[deps.get_session_store] = lambda: Sessions()
    monkeypatch.setattr(auth, "enforce_rate_limit", no_rate_side_effect)
    monkeypatch.setattr(auth, "hash_account_password", record_hash)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.headers["X-Device-Id"] = "dev_synthetich1device00000001"
        yield client, database, hashed


async def register(client, password, email="synthetic-h1@example.com"):
    # Escaped JSON deliberately also exercises lone-surrogate rejection.
    return await client.post(
        "/api/v1/auth/register",
        content=json.dumps({"email": email, "password": password}, ensure_ascii=True),
        headers={"Content-Type": "application/json"},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("password", ["x" * 12, "x" * 13, "x" * 14, "😀" * 7, "😀" * 14])
async def test_new_registration_requires_15_codepoints(isolated_api, password):
    client, database, hashed = isolated_api
    response = await register(client, password)
    assert response.status_code == 422
    assert response.json() == {"detail": "account_password_too_short"}
    assert password not in response.text
    assert not hashed and not database.added


@pytest.mark.asyncio
@pytest.mark.parametrize("password", ["passwordpassword", "PASSWORDPASSWORD", "4AllPass4AllPass"])
async def test_whole_offline_blocklisted_password_is_rejected_before_kdf(isolated_api, password):
    client, database, hashed = isolated_api
    response = await register(client, password)
    assert response.status_code == 422
    assert response.json() == {"detail": "account_password_blocklisted"}
    assert password not in response.text
    assert not hashed and not database.added


@pytest.mark.asyncio
async def test_whole_username_is_blocklisted_without_rejecting_substrings(isolated_api):
    client, _, hashed = isolated_api
    response = await register(client, "synthetic-long-user", "synthetic-long-user@example.com")
    assert response.status_code == 422
    assert response.json() == {"detail": "account_password_blocklisted"}
    assert not hashed


@pytest.mark.asyncio
@pytest.mark.parametrize("password", [
    "synthetic-unlisted", "😀" * 15, "😀" * 256,
    "x" * 256, "  synthetic spaced phrase  ",
    "synthetic prefix passwordpassword suffix",
    "Cafe\u0301 synthetic phrase",
])
async def test_allowed_boundaries_are_hashed_in_full_without_normalization(isolated_api, password):
    client, _, hashed = isolated_api
    response = await register(client, password)
    assert response.status_code == 200
    assert hashed == [password]


@pytest.mark.asyncio
@pytest.mark.parametrize("password", ["x" * 257, "😀" * 257])
async def test_256_codepoint_ceiling_has_safe_error_and_no_truncation(isolated_api, password):
    client, database, hashed = isolated_api
    response = await register(client, password)
    assert response.status_code == 422
    assert response.json() == {"detail": "account_password_too_long"}
    assert password not in response.text
    assert not hashed and not database.added


@pytest.mark.asyncio
async def test_unencodable_unicode_is_rejected_without_echo_or_kdf(isolated_api):
    client, database, hashed = isolated_api
    response = await register(client, "\ud800" + "x" * 14)
    assert response.status_code == 422
    assert response.json() == {"detail": "account_password_invalid"}
    assert not hashed and not database.added


@pytest.mark.asyncio
async def test_invalid_registration_body_never_echoes_nested_password(isolated_api):
    client, database, hashed = isolated_api
    response = await client.post("/api/v1/auth/register", json=[{
        "email": "synthetic-h1@example.com", "password": "synthetic-hidden-password",
    }])
    assert response.status_code == 422
    assert response.json() == {"detail": "invalid_registration"}
    assert "synthetic-hidden-password" not in response.text
    assert not hashed and not database.added


@pytest.mark.asyncio
@pytest.mark.parametrize("password", ["x" * 12, "x" * 13, "x" * 14, "passwordpassword"])
async def test_existing_accounts_keep_original_login_verification(isolated_api, password):
    client, database, hashed = isolated_api
    database.existing = User(
        id=uuid.uuid4(), email="synthetic-old@example.com", is_active=True,
        account_password_hash=hash_account_password(password),
    )
    response = await client.post("/api/v1/auth/login", json={
        "email": "synthetic-old@example.com", "password": password,
    })
    assert response.status_code == 200
    assert not hashed, "login must not rehash or reapply registration policy"


def test_existing_argon_path_hashes_all_utf8_bytes():
    password = "😀" * 256
    digest = hash_account_password(password)
    assert verify_account_password(password, digest)
    assert not verify_account_password(password[:-1] + "😁", digest)
