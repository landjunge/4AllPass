"""Security-boundary tests: devices, envelopes, revocation.

These tests exist so the API cannot claim a security property that it does
not actually implement. Device DELETE is metadata-only. WebAuthn fields are
client-asserted. Snapshot races must yield exactly one winner and a 409.
"""
from __future__ import annotations

import asyncio
import uuid

import pytest

from tests.security.helpers import (
    DEVICE_A,
    DEVICE_B,
    PASSWORD,
    _auth,
    _commit,
    _cred_b64,
    _cred_path,
    _device_envelope,
    _dke,
    _dke_path,
    _email,
    _entry,
    _master_envelope,
    _sealed_manifest,
    _signup,
    _vault,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

# --- Devices / envelopes / revocation ----------------------------------------


async def test_device_delete_is_metadata_only_and_does_not_claim_crypto_erase(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    first = await _commit(
        client,
        alice,
        vault_id,
        envelopes=[_master_envelope(), _device_envelope(DEVICE_A)],
    )
    assert first.status_code == 200
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": DEVICE_A, "label": "Phone"},
    )
    cred_id = _cred_b64()
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=_auth(alice),
        json={
            "credentialId": cred_id,
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id),
        headers=_auth(alice),
        json=_dke(vault_id, DEVICE_A, cred_id),
    )

    revoked = await client.delete(f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", headers=_auth(alice))
    assert revoked.status_code == 200, revoked.text
    body = revoked.json()
    assert body["revokedAt"] is not None
    assert body["revocation"] == "metadata_only"
    assert body["hasDeviceEnvelope"] is True

    snapshot = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))
    assert snapshot.status_code == 200
    assert snapshot.json()["revision"] == 1
    types = [env["type"] for env in snapshot.json()["envelopes"]]
    assert "device" in types

    blocked_get = await client.get(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials/{_cred_path(cred_id)}/device-key-envelope",
        headers=_auth(alice),
    )
    assert blocked_get.status_code == 409
    blocked_put = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id),
        headers=_auth(alice),
        json=_dke(vault_id, DEVICE_A, cred_id),
    )
    assert blocked_put.status_code == 409
    blocked_cred = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=_auth(alice),
        json={
            "credentialId": _cred_b64(),
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert blocked_cred.status_code == 409


async def test_reregister_clears_metadata_flag_without_restoring_envelope(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    await _commit(client, alice, vault_id, envelopes=[_master_envelope()])
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": DEVICE_A, "label": "Phone"},
    )
    await client.delete(f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", headers=_auth(alice))
    again = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": DEVICE_A, "label": "Phone again"},
    )
    assert again.status_code == 200
    assert again.json()["revokedAt"] is None
    assert again.json()["revocation"] == "none"
    assert again.json()["hasDeviceEnvelope"] is False


async def test_envelope_identity_mismatch_and_cross_device_substitution(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    other = await _vault(client, alice)
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": DEVICE_A, "label": "A"},
    )
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": DEVICE_B, "label": "B"},
    )
    cred_id = _cred_b64()
    cred = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=_auth(alice),
        json={
            "credentialId": cred_id,
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert cred.status_code == 200, cred.text

    wrong_vault = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id),
        headers=_auth(alice),
        json=_dke(other, DEVICE_A, cred_id),
    )
    assert wrong_vault.status_code == 422

    wrong_device = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id),
        headers=_auth(alice),
        json=_dke(vault_id, DEVICE_B, cred_id),
    )
    assert wrong_device.status_code == 422

    missing_cred = await client.put(
        _dke_path(vault_id, DEVICE_B, cred_id),
        headers=_auth(alice),
        json=_dke(vault_id, DEVICE_B, cred_id),
    )
    assert missing_cred.status_code == 404


async def test_device_key_mirror_follows_the_active_snapshot(client):
    """Mirror PUT/GET is gated on the snapshot, not an independent blob store."""
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    assert (
        await _commit(
            client,
            alice,
            vault_id,
            envelopes=[_master_envelope(), _device_envelope(DEVICE_A)],
        )
    ).status_code == 200
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": DEVICE_A, "label": "Phone"},
    )
    cred_id = _cred_b64()
    cred = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=_auth(alice),
        json={
            "credentialId": cred_id,
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert cred.status_code == 200, cred.text

    stale = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id, expected_revision=0),
        headers=_auth(alice),
        json=_dke(vault_id, DEVICE_A, cred_id),
    )
    assert stale.status_code == 409

    ok = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id, expected_revision=1),
        headers=_auth(alice),
        json=_dke(vault_id, DEVICE_A, cred_id),
    )
    assert ok.status_code == 200, ok.text
    fetched = await client.get(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials/{_cred_path(cred_id)}/device-key-envelope",
        headers=_auth(alice),
    )
    assert fetched.status_code == 200

    wrong_gen = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id, expected_revision=1),
        headers=_auth(alice),
        json={**_dke(vault_id, DEVICE_A, cred_id), "deviceKeyVersion": 2},
    )
    assert wrong_gen.status_code == 409

    dropped = await _commit(
        client,
        alice,
        vault_id,
        expectedRevision=1,
        revision=2,
        envelopes=[_master_envelope()],
        sealedManifest=_sealed_manifest(),
    )
    assert dropped.status_code == 200, dropped.text
    gone = await client.get(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials/{_cred_path(cred_id)}/device-key-envelope",
        headers=_auth(alice),
    )
    assert gone.status_code == 404
    reattach = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id, expected_revision=2),
        headers=_auth(alice),
        json=_dke(vault_id, DEVICE_A, cred_id),
    )
    assert reattach.status_code == 409


async def test_concurrent_snapshot_commit_and_stale_mirror_put(client):
    """Interaktions-Testplan 1.3: snapshot N→N+1 vs mirror PUT expectedRevision=N.

    PUT with the old revision is 200 only if it still sees that head; after the
    commit lands it is 409. Never a 500, never a mirror that GET serves against
    a snapshot that dropped the device envelope.
    """
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    assert (
        await _commit(
            client,
            alice,
            vault_id,
            envelopes=[_master_envelope(), _device_envelope(DEVICE_A)],
        )
    ).status_code == 200
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": DEVICE_A, "label": "Phone"},
    )
    cred_id = _cred_b64()
    cred = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=_auth(alice),
        json={
            "credentialId": cred_id,
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert cred.status_code == 200, cred.text

    advance = {
        "expectedRevision": 1,
        "revision": 2,
        "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 1,
        "envelopes": [_master_envelope(), _device_envelope(DEVICE_A)],
        "entries": [],
        "sealedManifest": _sealed_manifest(),
    }
    commit, stale_put = await asyncio.gather(
        client.post(f"/api/v1/vaults/{vault_id}/snapshots", headers=_auth(alice), json=advance),
        client.put(
            _dke_path(vault_id, DEVICE_A, cred_id, expected_revision=1),
            headers=_auth(alice),
            json=_dke(vault_id, DEVICE_A, cred_id),
        ),
    )
    assert commit.status_code == 200, commit.text
    assert stale_put.status_code in {200, 409}, stale_put.text

    live = (await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))).json()
    assert live["revision"] == 2
    too_old = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id, expected_revision=1),
        headers=_auth(alice),
        json=_dke(vault_id, DEVICE_A, cred_id),
    )
    assert too_old.status_code == 409
    current = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id, expected_revision=2),
        headers=_auth(alice),
        json=_dke(vault_id, DEVICE_A, cred_id),
    )
    assert current.status_code == 200, current.text


async def test_concurrent_omit_envelope_commit_and_mirror_put(client):
    """1.3 drop-envelope variant: PUT must not keep a GET-able mirror after omit."""
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    assert (
        await _commit(
            client,
            alice,
            vault_id,
            envelopes=[_master_envelope(), _device_envelope(DEVICE_A)],
        )
    ).status_code == 200
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": DEVICE_A, "label": "Phone"},
    )
    cred_id = _cred_b64()
    assert (
        await client.post(
            f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
            headers=_auth(alice),
            json={
                "credentialId": cred_id,
                "rpId": "localhost",
                "mechanism": "prf",
                "prfSupported": True,
                "largeBlobSupported": False,
            },
        )
    ).status_code == 200

    omit = {
        "expectedRevision": 1,
        "revision": 2,
        "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 1,
        "envelopes": [_master_envelope()],
        "entries": [],
        "sealedManifest": _sealed_manifest(),
    }
    commit, stale_put = await asyncio.gather(
        client.post(f"/api/v1/vaults/{vault_id}/snapshots", headers=_auth(alice), json=omit),
        client.put(
            _dke_path(vault_id, DEVICE_A, cred_id, expected_revision=1),
            headers=_auth(alice),
            json=_dke(vault_id, DEVICE_A, cred_id),
        ),
    )
    assert commit.status_code == 200, commit.text
    assert stale_put.status_code in {200, 409}, stale_put.text
    gone = await client.get(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials/{_cred_path(cred_id)}/device-key-envelope",
        headers=_auth(alice),
    )
    assert gone.status_code == 404
    reattach = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id, expected_revision=2),
        headers=_auth(alice),
        json=_dke(vault_id, DEVICE_A, cred_id),
    )
    assert reattach.status_code == 409


async def test_hard_revoke_snapshot_does_not_kill_sessions_until_metadata_delete(client):
    """Interaktions-Testplan 2.2: session death is DELETE, not the VK++ snapshot."""
    email, owner = await _signup(client)
    vault_id = await _vault(client, owner)
    other = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": PASSWORD},
        headers={"X-Device-Id": DEVICE_B},
    )
    assert other.status_code == 200
    other_token = other.json()["token"]
    assert (
        await client.post(
            f"/api/v1/vaults/{vault_id}/devices",
            headers=_auth(owner),
            json={"deviceId": DEVICE_B, "label": "Phone"},
        )
    ).status_code == 200
    assert (
        await _commit(
            client,
            owner,
            vault_id,
            envelopes=[_master_envelope(), _device_envelope(DEVICE_B)],
        )
    ).status_code == 200

    rotated = await _commit(
        client,
        owner,
        vault_id,
        expectedRevision=1,
        revision=2,
        vaultKeyVersion=2,
        envelopes=[_master_envelope(vault_key_version=2)],
        sealedManifest=_sealed_manifest(),
    )
    assert rotated.status_code == 200, rotated.text
    still = await client.get(
        "/api/v1/auth/me",
        headers={**_auth(other_token), "X-Device-Id": DEVICE_B},
    )
    assert still.status_code == 200

    revoked = await client.delete(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_B}",
        headers=_auth(owner),
    )
    assert revoked.status_code == 200
    dead = await client.get(
        "/api/v1/auth/me",
        headers={**_auth(other_token), "X-Device-Id": DEVICE_B},
    )
    assert dead.status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=_auth(owner))).status_code == 200


async def test_concurrent_reenrol_same_device_id_one_row(client):
    """Interaktions-Testplan 2.3: two POSTs of the same deviceId after revoke."""
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    assert (
        await client.post(
            f"/api/v1/vaults/{vault_id}/devices",
            headers=_auth(alice),
            json={"deviceId": DEVICE_A, "label": "Phone"},
        )
    ).status_code == 200
    assert (
        await client.delete(f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", headers=_auth(alice))
    ).status_code == 200

    first, second = await asyncio.gather(
        client.post(
            f"/api/v1/vaults/{vault_id}/devices",
            headers=_auth(alice),
            json={"deviceId": DEVICE_A, "label": "Phone-a"},
        ),
        client.post(
            f"/api/v1/vaults/{vault_id}/devices",
            headers=_auth(alice),
            json={"deviceId": DEVICE_A, "label": "Phone-b"},
        ),
    )
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    listed = await client.get(f"/api/v1/vaults/{vault_id}/devices", headers=_auth(alice))
    assert listed.status_code == 200
    rows = [d for d in listed.json() if d["deviceId"] == DEVICE_A]
    assert len(rows) == 1
    assert rows[0]["revokedAt"] is None


async def test_snapshot_commit_rejects_ownership_and_revision_overrides(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    response = await _commit(
        client,
        alice,
        vault_id,
        ownerUserId=str(uuid.uuid4()),
        userId=str(uuid.uuid4()),
        vaultId=str(uuid.uuid4()),
        revokedAt=None,
        isAdmin=True,
    )
    assert response.status_code == 422



async def test_revoking_a_device_kills_its_other_sessions(client):
    email, owner = await _signup(client)
    vault_id = await _vault(client, owner)

    other = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": PASSWORD},
        headers={"X-Device-Id": DEVICE_B},
    )
    assert other.status_code == 200
    other_token = other.json()["token"]

    registered = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(owner),
        json={"deviceId": DEVICE_B, "label": "Phone"},
    )
    assert registered.status_code == 200

    still = await client.get(
        "/api/v1/auth/me",
        headers={**_auth(other_token), "X-Device-Id": DEVICE_B},
    )
    assert still.status_code == 200

    revoked = await client.delete(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_B}",
        headers=_auth(owner),
    )
    assert revoked.status_code == 200

    dead = await client.get(
        "/api/v1/auth/me",
        headers={**_auth(other_token), "X-Device-Id": DEVICE_B},
    )
    assert dead.status_code == 401

    owner_still = await client.get("/api/v1/auth/me", headers=_auth(owner))
    assert owner_still.status_code == 200


