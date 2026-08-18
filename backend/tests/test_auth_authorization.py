import uuid
from collections.abc import AsyncIterator
from datetime import timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.api.deps import get_db
from app.db.redis import get_redis
from app.main import app
from app.models.device import Device
from app.models.user import User
from app.models.vault import Vault

pytestmark = pytest.mark.asyncio(loop_scope="session")


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    async def set(self, key: str, value: str, ex: timedelta) -> None:
        self.values[key] = value

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def delete(self, key: str) -> None:
        self.values.pop(key, None)


@pytest_asyncio.fixture
async def api_client(db_session) -> AsyncIterator[AsyncClient]:
    redis = FakeRedis()

    async def override_db():
        yield db_session

    async def override_redis():
        yield redis

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_redis] = override_redis
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


async def register(client: AsyncClient, email: str, password: str = "correct-horse-battery") -> dict:
    response = await client.post("/auth/register", json={"email": email, "password": password})
    assert response.status_code == 201, response.text
    return response.json()


async def test_register_hashes_password_sets_opaque_http_only_session_and_hides_secret(
    api_client, db_session, caplog
):
    password = "correct-horse-battery"
    result = await register(api_client, "alice@example.test", password)

    user = await db_session.get(User, uuid.UUID(result["id"]))
    assert user is not None
    assert user.account_password_hash is not None
    assert user.account_password_hash != password
    assert password not in api_client.cookies.get("fourallpass_session")
    assert password not in caplog.text
    assert "account_password_hash" not in result
    assert password not in str(result)

    cookie = api_client.cookies.get("fourallpass_session")
    assert cookie
    set_cookie = api_client.cookies.jar._cookies["test.local"]["/"]["fourallpass_session"]
    assert set_cookie.has_nonstandard_attr("HttpOnly")


async def test_duplicate_registration_and_login_failure_do_not_authenticate(api_client):
    await register(api_client, "alice@example.test")

    duplicate = await api_client.post(
        "/auth/register",
        json={"email": "alice@example.test", "password": "different-password"},
    )
    assert duplicate.status_code == 409

    bad_login = await api_client.post(
        "/auth/login",
        json={"email": "alice@example.test", "password": "not-the-right-password"},
    )
    assert bad_login.status_code == 401
    assert "fourallpass_session" not in bad_login.headers.get("set-cookie", "")


async def test_login_me_logout_and_invalidated_session(api_client):
    user = await register(api_client, "alice@example.test")
    original_session = api_client.cookies.get("fourallpass_session")
    api_client.cookies.clear()

    login = await api_client.post(
        "/auth/login",
        json={"email": "alice@example.test", "password": "correct-horse-battery"},
    )
    assert login.status_code == 200
    assert api_client.cookies.get("fourallpass_session") != original_session

    me = await api_client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["id"] == user["id"]

    logout = await api_client.post("/auth/logout")
    assert logout.status_code == 204
    assert api_client.cookies.get("fourallpass_session") is None
    assert (await api_client.get("/auth/me")).status_code == 401


async def test_missing_invalid_and_expired_sessions_are_rejected(api_client):
    assert (await api_client.get("/auth/me")).status_code == 401

    api_client.cookies.set("fourallpass_session", "unknown-session")
    assert (await api_client.get("/auth/me")).status_code == 401

    await register(api_client, "alice@example.test")
    api_client.cookies.set("fourallpass_session", "expired-session")
    assert (await api_client.get("/auth/me")).status_code == 401


async def test_vault_creation_uses_session_identity_and_rejects_mass_assignment(api_client):
    user = await register(api_client, "alice@example.test")
    create = await api_client.post(
        "/vaults",
        json={"crypto_protocol_version": 1},
        headers={"X-User-Id": str(uuid.uuid4())},
    )
    assert create.status_code == 201
    vault = create.json()

    created = await api_client.get("/vaults/not-a-uuid/devices")
    assert created.status_code == 422

    mass_assignment = await api_client.post(
        "/vaults",
        json={"crypto_protocol_version": 1, "owner_user_id": str(uuid.uuid4())},
    )
    assert mass_assignment.status_code == 422

    me = await api_client.get("/auth/me")
    assert me.json()["id"] == user["id"]
    assert "owner_user_id" not in vault


async def test_vault_and_device_idor_protection(api_client, db_session):
    alice = await register(api_client, "alice@example.test")
    alice_vault = await api_client.post("/vaults", json={})
    assert alice_vault.status_code == 201

    api_client.cookies.clear()
    bob = await register(api_client, "bob@example.test")
    bob_vault = await api_client.post("/vaults", json={})
    assert bob_vault.status_code == 201
    bob_device = Device(vault_id=uuid.UUID(bob_vault.json()["id"]), device_id="bob-laptop")
    db_session.add(bob_device)
    await db_session.commit()

    # Foreign and nonexistent IDs both return 404 after successful authentication.
    foreign = await api_client.get(f"/vaults/{alice_vault.json()['id']}/devices")
    random = await api_client.get(f"/vaults/{uuid.uuid4()}/devices")
    assert foreign.status_code == random.status_code == 404

    foreign_device = await api_client.get(
        f"/vaults/{alice_vault.json()['id']}/devices/{bob_device.id}"
    )
    assert foreign_device.status_code == 404

    api_client.cookies.clear()
    await api_client.post(
        "/auth/login",
        json={"email": "alice@example.test", "password": "correct-horse-battery"},
    )
    own = await api_client.get(f"/vaults/{alice_vault.json()['id']}/devices")
    assert own.status_code == 200

    # A device ID cannot be substituted across otherwise authorized vaults.
    cross_vault_device = await api_client.get(
        f"/vaults/{alice_vault.json()['id']}/devices/{bob_device.id}"
    )
    assert cross_vault_device.status_code == 404
    assert alice["id"] != bob["id"]


async def test_unauthenticated_device_requests_do_not_disclose_vaults(api_client, db_session):
    owner = User(email="owner@example.test", account_password_hash="not-used")
    db_session.add(owner)
    await db_session.flush()
    vault = Vault(owner_user_id=owner.id)
    db_session.add(vault)
    await db_session.flush()

    response = await api_client.get(f"/vaults/{vault.id}/devices")
    assert response.status_code == 401
