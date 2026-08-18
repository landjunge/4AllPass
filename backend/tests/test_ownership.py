import uuid

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASSWORD = "account-password-1234"
COOKIE_NAME = "4allpass_session"


async def _signup(client, email: str | None = None) -> tuple[str, str]:
    email = email or f"owner-{uuid.uuid4().hex[:10]}@example.com"
    response = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return email, response.cookies[COOKIE_NAME]


def _auth(token: str) -> dict[str, str]:
    return {"Cookie": f"{COOKIE_NAME}={token}"}


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


async def test_vault_access_requires_auth(client):
    _, alice = await _signup(client)
    created = await client.post("/api/v1/vaults", headers=_auth(alice))
    vault_id = created.json()["vaultId"]
    client.cookies.clear()

    assert (await client.get("/api/v1/vaults")).status_code == 401
    assert (await client.post("/api/v1/vaults")).status_code == 401
    assert (await client.get(f"/api/v1/vaults/{vault_id}")).status_code == 401


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
            "envelopes": [_master_envelope()],
            "entries": [],
        },
    )
    assert second.status_code == 200, second.text
    assert second.json()["revision"] == 2


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


async def test_device_id_cannot_cross_vault_or_owner_boundaries(client):
    _, alice = await _signup(client)
    _, bob = await _signup(client)
    alice_vault = (
        await client.post("/api/v1/vaults", headers=_auth(alice))
    ).json()["vaultId"]
    bob_vault = (
        await client.post("/api/v1/vaults", headers=_auth(bob))
    ).json()["vaultId"]
    device_id = "dev_shared_public_identifier"

    registered = await client.post(
        f"/api/v1/vaults/{alice_vault}/devices",
        headers=_auth(alice),
        json={"deviceId": device_id, "label": "Alice device"},
    )
    assert registered.status_code == 200

    foreign_device = await client.get(
        f"/api/v1/vaults/{alice_vault}/devices/{device_id}",
        headers=_auth(bob),
    )
    assert foreign_device.status_code == 404

    wrong_vault = await client.get(
        f"/api/v1/vaults/{bob_vault}/devices/{device_id}",
        headers=_auth(bob),
    )
    assert wrong_vault.status_code == 404


async def test_foreign_and_random_vault_ids_are_indistinguishable(client):
    _, alice = await _signup(client)
    _, bob = await _signup(client)
    alice_vault = (
        await client.post("/api/v1/vaults", headers=_auth(alice))
    ).json()["vaultId"]

    foreign = await client.get(f"/api/v1/vaults/{alice_vault}", headers=_auth(bob))
    random = await client.get(f"/api/v1/vaults/{uuid.uuid4()}", headers=_auth(bob))

    assert foreign.status_code == random.status_code == 404
    assert foreign.json() == random.json() == {"detail": "vault not found"}


async def test_client_cannot_assign_owner_or_user_identity(client):
    _, alice = await _signup(client)
    _, bob = await _signup(client)

    forged_vault = await client.post(
        "/api/v1/vaults",
        headers=_auth(alice),
        json={"ownerId": str(uuid.uuid4())},
    )
    assert forged_vault.status_code == 422

    created = await client.post("/api/v1/vaults", headers=_auth(alice))
    vault_id = created.json()["vaultId"]
    forged_device = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={
            "deviceId": "dev_no_mass_assignment",
            "label": "Alice device",
            "userId": bob,
            "ownerId": bob,
        },
    )
    assert forged_device.status_code == 422
