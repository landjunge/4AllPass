"""Shared builders for security-boundary API tests."""
from __future__ import annotations

import base64
import uuid


PASSWORD = "account-password-1234"
DEVICE_A = "dev_aaaaaaaaaaaaaaaaaaaaaaaa"
DEVICE_B = "dev_bbbbbbbbbbbbbbbbbbbbbbbb"


def _email() -> str:
    return f"sec-{uuid.uuid4().hex[:10]}@example.com"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _master_envelope(vault_key_version: int = 1, ciphertext: str | None = None) -> dict:
    return {
        "version": 1,
        "type": "master",
        "vaultKeyVersion": vault_key_version,
        "encryption": "AES-256-GCM",
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": ciphertext or "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
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


def _device_envelope(device_id: str, vault_key_version: int = 1) -> dict:
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


def _sealed_manifest() -> dict:
    return {
        "version": 1,
        "encryption": "AES-256-GCM",
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ=",
        "tag": "BQUFBQUFBQUFBQUFBQUFBQ==",
    }


def _entry(entry_id: str = "entry-1") -> dict:
    return {
        "id": entry_id,
        "schemaVersion": 1,
        "cryptoVersion": 1,
        "vaultKeyVersion": 1,
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": "BgYGBgYGBgYGBgYGBgYGBg==",
        "tag": "BwcHBwcHBwcHBwcHBwcHBw==",
    }


def _cred_b64() -> str:
    return base64.b64encode(uuid.uuid4().bytes).decode("ascii")


def _dke(vault_id: str, device_id: str, credential_id: str) -> dict:
    return {
        "version": 1,
        "vaultId": vault_id,
        "deviceId": device_id,
        "credentialId": credential_id,
        "deviceKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg=",
        "tag": "CQkJCQkJCQkJCQkJCQkJCQ==",
    }


def _cred_path(credential_id: str) -> str:
    return credential_id.replace("+", "-").replace("/", "_").rstrip("=")


def _dke_path(
    vault_id: str, device_id: str, credential_id: str, expected_revision: int = 1
) -> str:
    return (
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_cred_path(credential_id)}"
        f"/device-key-envelope?expectedRevision={expected_revision}"
    )


async def _signup(client, email: str | None = None) -> tuple[str, str]:
    email = email or _email()
    response = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return email, response.json()["token"]


async def _vault(client, token: str) -> str:
    created = await client.post("/api/v1/vaults", headers=_auth(token))
    assert created.status_code == 201, created.text
    return created.json()["vaultId"]


async def _commit(client, token: str, vault_id: str, **overrides) -> object:
    body = {
        "revision": 1,
        "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 1,
        "envelopes": [_master_envelope()],
        "entries": [],
    }
    body.update(overrides)
    return await client.post(f"/api/v1/vaults/{vault_id}/snapshots", headers=_auth(token), json=body)


