import asyncio
import uuid

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASSWORD = "account-password-1234"


async def _signup(client, email: str | None = None) -> tuple[str, dict[str, str]]:
    email = email or f"owner-{uuid.uuid4().hex[:10]}@example.com"
    response = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    session = response.cookies["4allpass_session"]
    csrf = response.cookies["4allpass_csrf"]
    client.cookies.clear()
    return email, {
        "Cookie": f"4allpass_session={session}; 4allpass_csrf={csrf}",
        "X-CSRF-Token": csrf,
    }


def _auth(session: dict[str, str]) -> dict[str, str]:
    return session


def _master_envelope() -> dict:
    return {
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
    }


def _manifest() -> dict:
    return {
        "version": 1,
        "encryption": "AES-256-GCM",
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQ==",
        "tag": "AgICAgICAgICAgICAgICAg==",
    }


async def test_user_cannot_read_foreign_vault_or_devices(client):
    _, alice = await _signup(client)
    _, bob = await _signup(client)

    created = await client.post("/api/v1/vaults", headers=_auth(alice))
    assert created.status_code == 201
    vault_id = created.json()["vaultId"]

    forbidden_get = await client.get(f"/api/v1/vaults/{vault_id}", headers=_auth(bob))
    assert forbidden_get.status_code == 404

    forbidden_devices = await client.get(f"/api/v1/vaults/{vault_id}/devices", headers=_auth(bob))
    assert forbidden_devices.status_code == 404

    forbidden_snapshot = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(bob))
    assert forbidden_snapshot.status_code == 404

    listed = await client.get("/api/v1/vaults", headers=_auth(bob))
    assert listed.status_code == 200
    assert listed.json() == []


async def test_devices_require_auth(client):
    _, alice = await _signup(client)
    created = await client.post("/api/v1/vaults", headers=_auth(alice))
    vault_id = created.json()["vaultId"]
    client.cookies.clear()
    anon = await client.get(f"/api/v1/vaults/{vault_id}/devices")
    assert anon.status_code == 401


async def test_snapshot_cas_and_ownership(client):
    _, alice = await _signup(client)
    created = await client.post("/api/v1/vaults", headers=_auth(alice))
    vault_id = created.json()["vaultId"]

    first = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=_auth(alice),
        json={
            "revision": 1,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "manifest": _manifest(),
            "envelopes": [_master_envelope()],
            "entries": [],
        },
    )
    assert first.status_code == 200, first.text
    assert first.json()["revision"] == 1
    assert first.json()["vaultId"] == vault_id
    assert first.json()["envelopes"][0]["type"] == "master"

    fetched = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))
    assert fetched.status_code == 200
    assert fetched.json()["revision"] == 1

    conflict = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=_auth(alice),
        json={
            "expectedRevision": 0,
            "revision": 1,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "manifest": _manifest(),
            "envelopes": [_master_envelope()],
            "entries": [],
        },
    )
    assert conflict.status_code == 409
    assert conflict.json()["currentRevision"] == 1

    second = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=_auth(alice),
        json={
            "expectedRevision": 1,
            "revision": 2,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "manifest": _manifest(),
            "envelopes": [_master_envelope()],
            "entries": [],
        },
    )
    assert second.status_code == 200, second.text
    assert second.json()["revision"] == 2

    next_payload = {
        "expectedRevision": 2,
        "revision": 3,
        "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 1,
        "manifest": _manifest(),
        "envelopes": [_master_envelope()],
        "entries": [],
    }
    concurrent = await asyncio.gather(
        client.post(
            f"/api/v1/vaults/{vault_id}/snapshots",
            headers=_auth(alice),
            json=next_payload,
        ),
        client.post(
            f"/api/v1/vaults/{vault_id}/snapshots",
            headers=_auth(alice),
            json=next_payload,
        ),
    )
    assert sorted(response.status_code for response in concurrent) == [200, 409]
    winner = next(response for response in concurrent if response.status_code == 200)
    loser = next(response for response in concurrent if response.status_code == 409)
    assert winner.json()["revision"] == 3
    assert loser.json()["detail"] == "revision conflict"
    assert loser.json()["currentRevision"] in {2, 3}
    active = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))
    assert active.status_code == 200
    assert active.json()["revision"] == 3


async def test_register_device_roundtrip(client):
    _, alice = await _signup(client)
    created = await client.post("/api/v1/vaults", headers=_auth(alice))
    vault_id = created.json()["vaultId"]

    registered = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={
            "deviceId": "dev_aabbccddeeff001122334455",
            "label": "Chrome on Linux",
            "platform": "Linux",
            "userAgentSummary": "Chrome on Linux",
        },
    )
    assert registered.status_code == 200, registered.text
    assert registered.json()["deviceId"] == "dev_aabbccddeeff001122334455"
    assert registered.json()["label"] == "Chrome on Linux"

    listed = await client.get(f"/api/v1/vaults/{vault_id}/devices", headers=_auth(alice))
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["hasDeviceEnvelope"] is False
