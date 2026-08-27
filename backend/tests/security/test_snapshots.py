"""Security-boundary tests: snapshot CAS.

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

# --- Snapshots ---------------------------------------------------------------


async def test_snapshot_preserves_ciphertext_and_optional_manifest(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    ciphertext = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="
    manifest = _sealed_manifest()
    entry = _entry()
    posted = await _commit(
        client,
        alice,
        vault_id,
        envelopes=[_master_envelope(ciphertext=ciphertext)],
        entries=[entry],
        sealedManifest=manifest,
    )
    assert posted.status_code == 200, posted.text
    body = posted.json()
    assert body["envelopes"][0]["ciphertext"] == ciphertext
    assert body["entries"][0]["ciphertext"] == entry["ciphertext"]
    assert body["sealedManifest"] == manifest
    assert "password" not in str(body).lower()

    fetched = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))
    assert fetched.json()["sealedManifest"] == manifest
    assert fetched.json()["revision"] == 1


async def test_vault_key_version_cannot_decrease(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    assert (await _commit(client, alice, vault_id, vaultKeyVersion=2)).status_code == 200
    lowered = await _commit(
        client,
        alice,
        vault_id,
        expectedRevision=1,
        revision=2,
        vaultKeyVersion=1,
    )
    assert lowered.status_code == 422


async def test_stale_revision_is_conflict_and_does_not_change_bytes(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    first = await _commit(client, alice, vault_id, envelopes=[_master_envelope(ciphertext="AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=")])
    assert first.status_code == 200
    conflict = await _commit(
        client,
        alice,
        vault_id,
        expectedRevision=0,
        revision=1,
        envelopes=[_master_envelope(ciphertext="AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=")],
    )
    assert conflict.status_code == 409
    assert conflict.json()["currentRevision"] == 1
    fetched = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))
    assert fetched.json()["envelopes"][0]["ciphertext"] == "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="


async def test_concurrent_revision_writes_one_wins(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    assert (await _commit(client, alice, vault_id)).status_code == 200

    payload = {
        "expectedRevision": 1,
        "revision": 2,
        "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 1,
        "envelopes": [_master_envelope()],
        "entries": [],
        "sealedManifest": _sealed_manifest(),
    }
    first, second = await asyncio.gather(
        client.post(f"/api/v1/vaults/{vault_id}/snapshots", headers=_auth(alice), json=payload),
        client.post(f"/api/v1/vaults/{vault_id}/snapshots", headers=_auth(alice), json=payload),
    )
    statuses = sorted([first.status_code, second.status_code])
    assert statuses == [200, 409], (first.status_code, first.text, second.status_code, second.text)
    loser = first if first.status_code == 409 else second
    # After the winner commits, the live head is 2. Reporting 1 would send the
    # client back into the same collision.
    assert loser.json()["currentRevision"] == 2
    fetched = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))
    assert fetched.json()["revision"] == 2


async def test_commit_rejects_revoked_device_envelope(client):
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
    revoked = await client.delete(f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", headers=_auth(alice))
    assert revoked.status_code == 200
    assert revoked.json()["revocation"] == "metadata_only"

    reattach = await _commit(
        client,
        alice,
        vault_id,
        expectedRevision=1,
        revision=2,
        envelopes=[_master_envelope(), _device_envelope(DEVICE_A)],
        sealedManifest=_sealed_manifest(),
    )
    assert reattach.status_code == 422
    assert "revoked" in reattach.json()["detail"].lower()


async def test_commit_requires_sealed_manifest_after_first_revision(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    assert (await _commit(client, alice, vault_id)).status_code == 200

    missing = await _commit(
        client,
        alice,
        vault_id,
        expectedRevision=1,
        revision=2,
        envelopes=[_master_envelope()],
    )
    assert missing.status_code == 422
    assert "sealedmanifest" in missing.json()["detail"].lower()

    ok = await _commit(
        client,
        alice,
        vault_id,
        expectedRevision=1,
        revision=2,
        envelopes=[_master_envelope()],
        sealedManifest=_sealed_manifest(),
    )
    assert ok.status_code == 200, ok.text


async def test_soft_revoke_commit_omitting_envelope_still_works(client):
    """Soft path: metadata DELETE, then commit without that device envelope, same VKV."""
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    assert (
        await _commit(
            client,
            alice,
            vault_id,
            envelopes=[_master_envelope(), _device_envelope(DEVICE_A), _device_envelope(DEVICE_B)],
        )
    ).status_code == 200
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": DEVICE_A, "label": "Phone"},
    )
    await client.delete(f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", headers=_auth(alice))

    soft = await _commit(
        client,
        alice,
        vault_id,
        expectedRevision=1,
        revision=2,
        vaultKeyVersion=1,
        envelopes=[_master_envelope(), _device_envelope(DEVICE_B)],
        sealedManifest=_sealed_manifest(),
    )
    assert soft.status_code == 200, soft.text
    body = soft.json()
    assert body["revision"] == 2
    assert body["vaultKeyVersion"] == 1
    device_ids = [env["deviceId"] for env in body["envelopes"] if env["type"] == "device"]
    assert DEVICE_A not in device_ids
    assert DEVICE_B in device_ids


def _device_ids(snapshot: dict) -> list[str]:
    return [env["deviceId"] for env in snapshot["envelopes"] if env["type"] == "device"]


async def test_concurrent_same_vk_commit_and_hard_revoke_one_wins(client):
    """Interaktions-Testplan 1.2: same-VK N→N+1 vs hard-revoke (VK++) N→N+1.

    Writers are serialized. Exactly one 200; the other 409. The live head is
    whichever payload held the lock. The loser retries on currentRevision with
    the live vaultKeyVersion — it must not decrease VK.
    """
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    seeded = await _commit(
        client,
        alice,
        vault_id,
        envelopes=[_master_envelope(), _device_envelope(DEVICE_A), _device_envelope(DEVICE_B)],
    )
    assert seeded.status_code == 200, seeded.text
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": DEVICE_A, "label": "Phone"},
    )

    same_vk = {
        "expectedRevision": 1,
        "revision": 2,
        "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 1,
        "envelopes": [
            _master_envelope(ciphertext="AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE="),
            _device_envelope(DEVICE_A),
            _device_envelope(DEVICE_B),
        ],
        "entries": [],
        "sealedManifest": _sealed_manifest(),
    }
    hard_revoke = {
        "expectedRevision": 1,
        "revision": 2,
        "vaultKeyVersion": 2,
        "cryptoProtocolVersion": 1,
        "envelopes": [
            _master_envelope(vault_key_version=2, ciphertext="AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI="),
            _device_envelope(DEVICE_B, vault_key_version=2),
        ],
        "entries": [],
        "sealedManifest": _sealed_manifest(),
    }
    same, hard = await asyncio.gather(
        client.post(f"/api/v1/vaults/{vault_id}/snapshots", headers=_auth(alice), json=same_vk),
        client.post(f"/api/v1/vaults/{vault_id}/snapshots", headers=_auth(alice), json=hard_revoke),
    )
    statuses = sorted([same.status_code, hard.status_code])
    assert statuses == [200, 409], (same.status_code, same.text, hard.status_code, hard.text)
    loser = same if same.status_code == 409 else hard
    assert loser.json()["currentRevision"] == 2

    live = (await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))).json()
    assert live["revision"] == 2

    if hard.status_code == 200:
        assert live["vaultKeyVersion"] == 2
        assert DEVICE_A not in _device_ids(live)
        assert DEVICE_B in _device_ids(live)
        decreased = await _commit(
            client,
            alice,
            vault_id,
            expectedRevision=2,
            revision=3,
            vaultKeyVersion=1,
            envelopes=[_master_envelope()],
            sealedManifest=_sealed_manifest(),
        )
        assert decreased.status_code == 422
        retry = await _commit(
            client,
            alice,
            vault_id,
            expectedRevision=2,
            revision=3,
            vaultKeyVersion=2,
            envelopes=[
                _master_envelope(vault_key_version=2),
                _device_envelope(DEVICE_B, vault_key_version=2),
            ],
            sealedManifest=_sealed_manifest(),
        )
        assert retry.status_code == 200, retry.text
        assert retry.json()["vaultKeyVersion"] == 2
        assert DEVICE_A not in _device_ids(retry.json())
    else:
        assert live["vaultKeyVersion"] == 1
        assert DEVICE_A in _device_ids(live)
        retry_hard = await _commit(
            client,
            alice,
            vault_id,
            expectedRevision=2,
            revision=3,
            vaultKeyVersion=2,
            envelopes=[
                _master_envelope(vault_key_version=2, ciphertext="AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI="),
                _device_envelope(DEVICE_B, vault_key_version=2),
            ],
            sealedManifest=_sealed_manifest(),
        )
        assert retry_hard.status_code == 200, retry_hard.text
        assert retry_hard.json()["revision"] == 3
        assert retry_hard.json()["vaultKeyVersion"] == 2
        assert DEVICE_A not in _device_ids(retry_hard.json())
        assert DEVICE_B in _device_ids(retry_hard.json())


async def test_snapshot_without_master_envelope_is_rejected(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    response = await _commit(client, alice, vault_id, envelopes=[_device_envelope(DEVICE_A)])
    assert response.status_code == 422



async def test_snapshot_rejects_oversized_ciphertext(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    huge = "A" * 1_400_001
    response = await _commit(client, alice, vault_id, envelopes=[_master_envelope(ciphertext=huge)])
    assert response.status_code == 422
