import json
import time
import uuid

import pytest
from httpx import AsyncClient
from redis.asyncio import Redis

from app.core.config import get_settings
from app.core.security import hash_password, verify_password
from app.db.redis import get_redis_client

pytestmark = pytest.mark.asyncio(loop_scope="session")
settings = get_settings()


async def test_session_fixation_attack_mitigation(client: AsyncClient):
    """Ensure logging in generates a brand new session token and does not reuse pre-auth session tokens."""
    # Pre-auth session token planted by attacker
    attacker_token = "attacker_preseeded_session_token_12345"
    client.cookies.set(settings.session_cookie_name, attacker_token)

    # Register legitimate user
    reg = await client.post(
        "/auth/register",
        json={"email": "victim_fixation@example.com", "password": "Password123!"},
    )
    assert reg.status_code == 201
    reg_cookie = reg.cookies[settings.session_cookie_name]
    assert reg_cookie != attacker_token

    # Login
    client.cookies.set(settings.session_cookie_name, attacker_token)
    login_resp = await client.post(
        "/auth/login",
        json={"email": "victim_fixation@example.com", "password": "Password123!"},
    )
    assert login_resp.status_code == 200
    login_cookie = login_resp.cookies[settings.session_cookie_name]

    # Session token must be fresh and not the attacker's preseeded token
    assert login_cookie != attacker_token
    assert login_cookie != reg_cookie


async def test_expired_session_rejection(client: AsyncClient):
    """Ensure expired sessions in Redis are rejected immediately with 401."""
    # Register user
    reg = await client.post(
        "/auth/register",
        json={"email": "expired_user@example.com", "password": "Password123!"},
    )
    session_token = reg.cookies[settings.session_cookie_name]

    # Manually expire session in Redis
    redis = get_redis_client()
    await redis.delete(f"session:{session_token}")

    client.cookies.set(settings.session_cookie_name, session_token)
    resp = await client.get("/auth/me")
    assert resp.status_code == 401
    assert "invalid or expired session" in resp.json()["detail"].lower()


async def test_session_tampering_rejection(client: AsyncClient):
    """Ensure corrupted or modified session cookies return 401."""
    client.cookies.set(settings.session_cookie_name, "tampered_session_token_value")
    resp = await client.get("/auth/me")
    assert resp.status_code == 401


async def test_vault_id_enumeration_resistance(client: AsyncClient):
    """Ensure responses for unauthorized or non-existent vaults are identical 404s."""
    # User 1 registers and creates a vault
    client.cookies.clear()
    reg1 = await client.post(
        "/auth/register",
        json={"email": "enum1@example.com", "password": "Password123!"},
    )
    cookie1 = reg1.cookies[settings.session_cookie_name]
    client.cookies.set(settings.session_cookie_name, cookie1)

    v1_resp = await client.post("/vaults", json={})
    user1_vault_id = v1_resp.json()["id"]

    # User 2 registers
    client.cookies.clear()
    reg2 = await client.post(
        "/auth/register",
        json={"email": "enum2@example.com", "password": "Password123!"},
    )
    cookie2 = reg2.cookies[settings.session_cookie_name]
    client.cookies.set(settings.session_cookie_name, cookie2)

    # User 2 queries User 1's vault (unauthorized) vs a random vault (nonexistent)
    unauthorized_resp = await client.get(f"/vaults/{user1_vault_id}")
    nonexistent_resp = await client.get(f"/vaults/{uuid.uuid4()}")

    assert unauthorized_resp.status_code == 404
    assert nonexistent_resp.status_code == 404
    assert unauthorized_resp.json() == nonexistent_resp.json()


async def test_no_secret_leakage_in_api_responses(client: AsyncClient):
    """Audit all response models across auth, vaults, and devices to ensure no keys or hashes leak."""
    sensitive_keys = {
        "password",
        "account_password_hash",
        "master_key",
        "vault_key",
        "device_key",
        "dwk",
        "dk",
        "vk",
        "prf_output",
        "private_key",
        "session_secret",
    }

    # 1. Register endpoint
    reg = await client.post(
        "/auth/register",
        json={"email": "audit_user@example.com", "password": "SuperSecretPassword123!"},
    )
    reg_body = json.dumps(reg.json()).lower()
    for secret in sensitive_keys:
        assert secret not in reg_body, f"Found sensitive key {secret} in register response"

    # 2. Login endpoint
    login = await client.post(
        "/auth/login",
        json={"email": "audit_user@example.com", "password": "SuperSecretPassword123!"},
    )
    login_body = json.dumps(login.json()).lower()
    for secret in sensitive_keys:
        assert secret not in login_body, f"Found sensitive key {secret} in login response"

    # 3. Me endpoint
    me = await client.get("/auth/me")
    me_body = json.dumps(me.json()).lower()
    for secret in sensitive_keys:
        assert secret not in me_body, f"Found sensitive key {secret} in /auth/me response"

    # 4. Vault create endpoint
    vault_create = await client.post("/vaults", json={})
    vault_body = json.dumps(vault_create.json()).lower()
    for secret in sensitive_keys:
        assert secret not in vault_body, f"Found sensitive key {secret} in /vaults create response"

    # 5. Vault get endpoint
    vault_id = vault_create.json()["id"]
    vault_get = await client.get(f"/vaults/{vault_id}")
    vault_get_body = json.dumps(vault_get.json()).lower()
    for secret in sensitive_keys:
        assert secret not in vault_get_body, f"Found sensitive key {secret} in /vaults get response"

    # 6. Devices list endpoint
    devices = await client.get(f"/vaults/{vault_id}/devices")
    devices_body = json.dumps(devices.json()).lower()
    for secret in sensitive_keys:
        assert secret not in devices_body, f"Found sensitive key {secret} in /devices list response"


async def test_password_hashing_security():
    """Verify password hashing core behavior and dummy verification resistance."""
    # Test valid hash
    pw = "CorrectBatteryHorseStaple99!"
    hashed = hash_password(pw)
    assert hashed.startswith("$argon2id$")
    assert verify_password(pw, hashed) is True
    assert verify_password("WrongPassword!", hashed) is False

    # Test None hash (dummy hash verification)
    assert verify_password(pw, None) is False

    # Test corrupted hash format handling
    assert verify_password(pw, "corrupted_hash_string") is False
