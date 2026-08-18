import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.device import Device
from app.models.device_key_envelope import DeviceKeyEnvelope
from app.models.webauthn_credential import WebAuthnCredential

pytestmark = pytest.mark.asyncio(loop_scope="session")
settings = get_settings()


async def test_device_routes_authorization_and_ownership(
    client: AsyncClient, db_session: AsyncSession
):
    # Register User 1 and create Vault 1
    reg1 = await client.post(
        "/auth/register",
        json={"email": "alice_device@example.com", "password": "Password123!"},
    )
    cookie1 = reg1.cookies[settings.session_cookie_name]
    client.cookies.set(settings.session_cookie_name, cookie1)

    v1_resp = await client.post("/vaults", json={})
    vault1_id = uuid.UUID(v1_resp.json()["id"])

    # Register Device 1 in Vault 1 directly in DB
    device1 = Device(
        vault_id=vault1_id,
        device_id="laptop-alice-stable-id",
        display_name="Alice's MacBook Pro",
        user_agent_summary="Mozilla/5.0 ...",
        last_seen_at=datetime.now(timezone.utc),
    )
    db_session.add(device1)
    await db_session.flush()
    device1_id = device1.id

    # Add WebAuthn credential for Device 1
    cred = WebAuthnCredential(
        device_id=device1_id,
        rp_id="4allpass.local",
        credential_id=b"test-credential-id-1234",
        public_key=b"cose-public-key-bytes",
        prf_supported=True,
    )
    db_session.add(cred)
    await db_session.flush()

    # Add DeviceKeyEnvelope for Device 1
    envelope = DeviceKeyEnvelope(
        vault_id=vault1_id,
        device_id=device1_id,
        webauthn_credential_id=cred.id,
        credential_id=b"test-credential-id-1234",
        nonce=b"0" * 12,
        ciphertext=b"ciphertext" * 4,
        tag=b"tag" * 4,
        crypto_version=1,
    )
    db_session.add(envelope)
    await db_session.commit()

    # 1. User 1 can list devices
    list_resp = await client.get(f"/vaults/{vault1_id}/devices")
    assert list_resp.status_code == 200
    devices = list_resp.json()
    assert len(devices) == 1
    assert devices[0]["device_id"] == "laptop-alice-stable-id"
    assert devices[0]["display_name"] == "Alice's MacBook Pro"
    assert devices[0]["has_device_key_envelope"] is True
    assert len(devices[0]["webauthn_credentials"]) == 1
    assert devices[0]["webauthn_credentials"][0]["prf_supported"] is True
    # Security: Ensure no private key material or ciphertexts are in the device summary
    assert "ciphertext" not in str(devices)
    assert "nonce" not in str(devices)
    assert "tag" not in str(devices)
    assert "public_key" not in str(devices)

    # 2. User 1 can get single device
    get_resp = await client.get(f"/vaults/{vault1_id}/devices/{device1_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == str(device1_id)
    assert get_resp.json()["has_device_key_envelope"] is True

    # 3. User 2 registers
    client.cookies.clear()
    reg2 = await client.post(
        "/auth/register",
        json={"email": "bob_device@example.com", "password": "Password123!"},
    )
    cookie2 = reg2.cookies[settings.session_cookie_name]
    client.cookies.set(settings.session_cookie_name, cookie2)

    v2_resp = await client.post("/vaults", json={})
    vault2_id = uuid.UUID(v2_resp.json()["id"])

    # 4. User 2 attempts to list User 1's devices -> MUST return 404 (IDOR defense)
    idor_list = await client.get(f"/vaults/{vault1_id}/devices")
    assert idor_list.status_code == 404
    assert "not found" in idor_list.json()["detail"].lower()

    # 5. User 2 attempts to get User 1's device -> MUST return 404
    idor_get = await client.get(f"/vaults/{vault1_id}/devices/{device1_id}")
    assert idor_get.status_code == 404

    # 6. User 2 attempts to query User 1's device_id under User 2's own vault_id -> MUST return 404
    cross_get = await client.get(f"/vaults/{vault2_id}/devices/{device1_id}")
    assert cross_get.status_code == 404

    # 7. Unauthenticated request -> MUST return 401
    client.cookies.clear()
    unauth_resp = await client.get(f"/vaults/{vault1_id}/devices")
    assert unauth_resp.status_code == 401
