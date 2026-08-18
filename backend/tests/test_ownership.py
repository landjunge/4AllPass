import pytest

from tests.helpers import API, create_vault, master_envelope, register

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_user_cannot_read_foreign_vault_or_devices(client_factory):
    alice = await register(client_factory())
    bob = await register(client_factory())

    vault_id = await create_vault(alice)

    forbidden_get = await bob.client.get(f"{API}/vaults/{vault_id}", headers=bob.auth)
    assert forbidden_get.status_code == 404

    forbidden_devices = await bob.client.get(f"{API}/vaults/{vault_id}/devices", headers=bob.auth)
    assert forbidden_devices.status_code == 404

    forbidden_snapshot = await bob.client.get(f"{API}/vaults/{vault_id}/snapshot", headers=bob.auth)
    assert forbidden_snapshot.status_code == 404

    listed = await bob.client.get(f"{API}/vaults", headers=bob.auth)
    assert listed.status_code == 200
    assert listed.json() == []


async def test_devices_require_auth(client_factory, anonymous_client):
    alice = await register(client_factory())
    vault_id = await create_vault(alice)
    anon = await anonymous_client.get(f"{API}/vaults/{vault_id}/devices")
    assert anon.status_code == 401


async def test_snapshot_cas_and_ownership(client_factory):
    alice = await register(client_factory())
    vault_id = await create_vault(alice)

    first = await alice.client.post(
        f"{API}/vaults/{vault_id}/snapshots",
        headers=alice.auth,
        json={
            "revision": 1,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "envelopes": [master_envelope()],
            "entries": [],
        },
    )
    assert first.status_code == 200, first.text
    assert first.json()["revision"] == 1
    assert first.json()["vaultId"] == vault_id
    assert first.json()["envelopes"][0]["type"] == "master"

    fetched = await alice.client.get(f"{API}/vaults/{vault_id}/snapshot", headers=alice.auth)
    assert fetched.status_code == 200
    assert fetched.json()["revision"] == 1

    conflict = await alice.client.post(
        f"{API}/vaults/{vault_id}/snapshots",
        headers=alice.auth,
        json={
            "expectedRevision": 0,
            "revision": 1,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "envelopes": [master_envelope()],
            "entries": [],
        },
    )
    assert conflict.status_code == 409
    assert conflict.json()["currentRevision"] == 1

    second = await alice.client.post(
        f"{API}/vaults/{vault_id}/snapshots",
        headers=alice.auth,
        json={
            "expectedRevision": 1,
            "revision": 2,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "envelopes": [master_envelope()],
            "entries": [],
        },
    )
    assert second.status_code == 200, second.text
    assert second.json()["revision"] == 2


async def test_register_device_roundtrip(client_factory):
    alice = await register(client_factory())
    vault_id = await create_vault(alice)

    registered = await alice.client.post(
        f"{API}/vaults/{vault_id}/devices",
        headers=alice.auth,
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

    listed = await alice.client.get(f"{API}/vaults/{vault_id}/devices", headers=alice.auth)
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["hasDeviceEnvelope"] is False
