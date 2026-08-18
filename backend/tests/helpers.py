import uuid

PASSWORD = "account-password-1234"


async def signup(client, email: str | None = None) -> tuple[str, str]:
    email = email or f"user-{uuid.uuid4().hex[:10]}@example.com"
    response = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return email, response.json()["token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def master_envelope(vault_key_version: int = 1) -> dict:
    return {
        "version": 1,
        "type": "master",
        "vaultKeyVersion": vault_key_version,
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
    }


def device_envelope(device_id: str, vault_key_version: int = 1) -> dict:
    return {
        "version": 1,
        "type": "device",
        "vaultKeyVersion": vault_key_version,
        "deviceId": device_id,
        "deviceKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=",
        "tag": "AwMDAwMDAwMDAwMDAwMDAw==",
    }


def opaque_entry(entry_id: str = "entry_bank") -> dict:
    return {
        "id": entry_id,
        "schemaVersion": 1,
        "cryptoVersion": 1,
        "vaultKeyVersion": 1,
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": "BAQEBAQEBAQEBAQEBAQEBA==",
        "tag": "BQUFBQUFBQUFBQUFBQUFBQ==",
    }


async def create_vault(client, token: str) -> str:
    created = await client.post("/api/v1/vaults", headers=auth(token))
    assert created.status_code == 201, created.text
    return created.json()["vaultId"]


async def commit_revision(client, token: str, vault_id: str, revision: int, expected: int | None, **kwargs):
    body = {
        "revision": revision,
        "vaultKeyVersion": kwargs.get("vault_key_version", 1),
        "cryptoProtocolVersion": 1,
        "envelopes": kwargs.get("envelopes", [master_envelope(kwargs.get("vault_key_version", 1))]),
        "entries": kwargs.get("entries", []),
    }
    if expected is not None:
        body["expectedRevision"] = expected
    return await client.post(f"/api/v1/vaults/{vault_id}/snapshots", headers=auth(token), json=body)


async def register_device(client, token: str, vault_id: str, device_id: str, **kwargs):
    return await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=auth(token),
        json={
            "deviceId": device_id,
            "label": kwargs.get("label", "Test device"),
            "platform": kwargs.get("platform", "Linux"),
            "userAgentSummary": kwargs.get("user_agent", "test"),
            "reactivate": kwargs.get("reactivate", False),
        },
    )
