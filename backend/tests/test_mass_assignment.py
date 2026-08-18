import uuid

import pytest

from tests.helpers import auth, create_vault, signup

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_register_rejects_unknown_fields(client):
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": f"mass-{uuid.uuid4().hex[:8]}@example.com",
            "password": "account-password-1234",
            "isAdmin": True,
            "is_admin": True,
            "accountId": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 422


async def test_login_rejects_unknown_fields(client):
    email, _ = await signup(client)
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "account-password-1234", "userId": str(uuid.uuid4())},
    )
    assert response.status_code == 422


async def test_device_register_rejects_ownership_overrides(client):
    _, token = await signup(client)
    vault_id = await create_vault(client, token)
    response = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=auth(token),
        json={
            "deviceId": "dev_mass_00112233445566778899",
            "label": "x",
            "vaultId": str(uuid.uuid4()),
            "revokedAt": None,
            "ownerUserId": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 422


async def test_snapshot_rejects_unknown_server_fields(client):
    _, token = await signup(client)
    vault_id = await create_vault(client, token)
    response = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=auth(token),
        json={
            "revision": 1,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "envelopes": [
                {
                    "version": 1,
                    "type": "master",
                    "vaultKeyVersion": 1,
                    "encryption": "AES-256-GCM",
                    "nonce": "AAAAAAAAAAAAAAAA",
                    "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
                    "tag": "AgICAgICAgICAgICAgICAg==",
                    "kdf": {
                        "algorithm": "argon2id",
                        "version": 19,
                        "memory": 65536,
                        "iterations": 3,
                        "parallelism": 4,
                        "hashLen": 32,
                        "salt": "ABEiM0RVZneImaq7zN3u/w==",
                    },
                    "ownerUserId": str(uuid.uuid4()),
                }
            ],
            "entries": [],
            "isAdmin": True,
        },
    )
    assert response.status_code == 422
