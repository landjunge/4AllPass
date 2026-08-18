import uuid

import pytest
from httpx import AsyncClient

from app.core.config import get_settings

pytestmark = pytest.mark.asyncio(loop_scope="session")
settings = get_settings()


async def test_create_vault_authenticated(client: AsyncClient):
    # Register and login user
    reg = await client.post(
        "/auth/register",
        json={"email": "vaultowner@example.com", "password": "Password123!"},
    )
    user_id = reg.json()["id"]

    # Create vault
    response = await client.post("/vaults", json={"crypto_protocol_version": 1})
    assert response.status_code == 201
    vault_data = response.json()
    assert "id" in vault_data
    assert vault_data["crypto_protocol_version"] == 1
    assert vault_data["active_snapshot_id"] is None
    # Ensure no internal or secret fields
    assert "vault_key" not in vault_data
    assert "master_key" not in vault_data

    # List vaults
    list_resp = await client.get("/vaults")
    assert list_resp.status_code == 200
    vaults = list_resp.json()
    assert len(vaults) == 1
    assert vaults[0]["id"] == vault_data["id"]

    # Get single vault
    get_resp = await client.get(f"/vaults/{vault_data['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == vault_data["id"]


async def test_create_vault_unauthenticated(client: AsyncClient):
    client.cookies.clear()
    response = await client.post("/vaults", json={})
    assert response.status_code == 401


async def test_vault_forged_owner_payload_rejected(client: AsyncClient):
    # Register user
    await client.post(
        "/auth/register",
        json={"email": "forger@example.com", "password": "Password123!"},
    )

    # Attempt to supply forged owner_user_id or user_id
    fake_owner_id = str(uuid.uuid4())
    response = await client.post(
        "/vaults",
        json={"owner_user_id": fake_owner_id, "crypto_protocol_version": 1},
    )
    # Pydantic schema extra="forbid" rejects unknown fields with 422
    assert response.status_code == 422


async def test_vault_ownership_isolation_between_users(client: AsyncClient):
    # User 1 registers and creates a vault
    client.cookies.clear()
    reg1 = await client.post(
        "/auth/register",
        json={"email": "user1@example.com", "password": "Password123!"},
    )
    cookie1 = reg1.cookies[settings.session_cookie_name]
    client.cookies.set(settings.session_cookie_name, cookie1)

    v1_resp = await client.post("/vaults", json={})
    assert v1_resp.status_code == 201
    vault1_id = v1_resp.json()["id"]

    # User 2 registers and creates a vault
    client.cookies.clear()
    reg2 = await client.post(
        "/auth/register",
        json={"email": "user2@example.com", "password": "Password123!"},
    )
    cookie2 = reg2.cookies[settings.session_cookie_name]
    client.cookies.set(settings.session_cookie_name, cookie2)

    v2_resp = await client.post("/vaults", json={})
    assert v2_resp.status_code == 201
    vault2_id = v2_resp.json()["id"]

    # User 2 should only see vault 2 in list
    list_user2 = await client.get("/vaults")
    assert list_user2.status_code == 200
    vault_ids_user2 = [v["id"] for v in list_user2.json()]
    assert vault2_id in vault_ids_user2
    assert vault1_id not in vault_ids_user2

    # User 2 attempts to get User 1's vault -> MUST return 404 (IDOR defense)
    idor_resp = await client.get(f"/vaults/{vault1_id}")
    assert idor_resp.status_code == 404
    assert "not found" in idor_resp.json()["detail"].lower()


async def test_vault_nonexistent_returns_404(client: AsyncClient):
    await client.post(
        "/auth/register",
        json={"email": "notfound_test@example.com", "password": "Password123!"},
    )
    random_vault_id = uuid.uuid4()
    response = await client.get(f"/vaults/{random_vault_id}")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()
