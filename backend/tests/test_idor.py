import uuid

import pytest

from tests.helpers import (
    auth,
    commit_revision,
    create_vault,
    device_envelope,
    master_envelope,
    register_device,
    signup,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

DEVICE_A = "dev_alice_aaaaaaaaaaaaaaaa"
DEVICE_B = "dev_bob_bbbbbbbbbbbbbbbbbb"
CRED_B64 = "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM="


async def _alice_vault_with_device(client):
    _, alice = await signup(client)
    vault_id = await create_vault(client, alice)
    registered = await register_device(client, alice, vault_id, DEVICE_A)
    assert registered.status_code == 200, registered.text
    cred = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=auth(alice),
        json={
            "credentialId": CRED_B64,
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert cred.status_code == 200, cred.text
    snap = await commit_revision(
        client,
        alice,
        vault_id,
        revision=1,
        expected=0,
        envelopes=[master_envelope(), device_envelope(DEVICE_A)],
    )
    assert snap.status_code == 200, snap.text
    return alice, vault_id


async def test_user_b_cannot_access_user_a_objects(client):
    alice, vault_id = await _alice_vault_with_device(client)
    _, bob = await signup(client)
    bob_vault = await create_vault(client, bob)

    forbidden = [
        ("GET", f"/api/v1/vaults/{vault_id}", None),
        ("GET", f"/api/v1/vaults/{vault_id}/snapshot", None),
        ("GET", f"/api/v1/vaults/{vault_id}/devices", None),
        ("GET", f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", None),
        (
            "POST",
            f"/api/v1/vaults/{vault_id}/devices",
            {"deviceId": DEVICE_B, "label": "evil"},
        ),
        (
            "POST",
            f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
            {
                "credentialId": "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=",
                "rpId": "evil.example",
                "mechanism": "prf",
                "prfSupported": True,
                "largeBlobSupported": False,
            },
        ),
        (
            "PUT",
            f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials/AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE/device-key-envelope",
            {
                "version": 1,
                "vaultId": vault_id,
                "deviceId": DEVICE_A,
                "credentialId": CRED_B64,
                "deviceKeyVersion": 1,
                "encryption": "AES-256-GCM",
                "nonce": "AAAAAAAAAAAAAAAA",
                "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
                "tag": "AgICAgICAgICAgICAgICAg==",
            },
        ),
        (
            "GET",
            f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials/AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE/device-key-envelope",
            None,
        ),
        ("DELETE", f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", None),
        (
            "POST",
            f"/api/v1/vaults/{vault_id}/snapshots",
            {
                "revision": 2,
                "expectedRevision": 1,
                "vaultKeyVersion": 1,
                "cryptoProtocolVersion": 1,
                "envelopes": [master_envelope()],
                "entries": [],
            },
        ),
    ]
    for method, path, body in forbidden:
        response = await client.request(method, path, headers=auth(bob), json=body)
        assert response.status_code == 404, (method, path, response.status_code, response.text)

    listed = await client.get("/api/v1/vaults", headers=auth(bob))
    assert listed.status_code == 200
    assert listed.json()[0]["vaultId"] == bob_vault
    assert all(row["vaultId"] != vault_id for row in listed.json())
    _ = alice


async def test_forged_ids_do_not_bypass_ownership(client):
    _, alice = await signup(client)
    forged_vault = str(uuid.uuid4())
    forged_device = "dev_forged_ffffffffffffffff"
    response = await client.get(f"/api/v1/vaults/{forged_vault}", headers=auth(alice))
    assert response.status_code == 404
    response = await client.get(
        f"/api/v1/vaults/{forged_vault}/devices/{forged_device}",
        headers=auth(alice),
    )
    assert response.status_code == 404


async def test_body_cannot_override_owner_or_revision_fields(client):
    _, alice = await signup(client)
    _, bob = await signup(client)
    vault_id = await create_vault(client, alice)
    hijack = await client.post(
        "/api/v1/vaults",
        headers=auth(bob),
        json={"ownerUserId": "00000000-0000-0000-0000-000000000001", "owner_user_id": str(uuid.uuid4())},
    )
    assert hijack.status_code == 201
    assert hijack.json()["vaultId"] != vault_id

    created = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=auth(alice),
        json={
            "deviceId": DEVICE_A,
            "label": "ok",
            "revokedAt": None,
            "isAdmin": True,
            "ownerUserId": str(uuid.uuid4()),
        },
    )
    assert created.status_code == 422
