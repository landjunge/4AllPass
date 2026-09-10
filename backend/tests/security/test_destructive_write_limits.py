"""ADR-015 §1 — the destructive vault routes are metered.

Neither of these stops a stolen session from writing; both stop it from
writing without limit. Device DELETE drops that device's sessions and blocks
its envelope mirror; the Device-Key-Envelope PUT overwrites unlock material.
Both used to be reachable with a bearer token and no rate limit at all.
"""
from __future__ import annotations

import pytest

from tests.security.helpers import (
    DEVICE_A,
    _auth,
    _commit,
    _device_envelope,
    _master_envelope,
    _sealed_manifest,
    _signup,
    _vault,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

WRITE_LIMIT = 30


async def test_device_delete_is_rate_limited(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    assert (await _commit(client, alice, vault_id)).status_code == 200

    registered = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": DEVICE_A, "label": "Laptop", "platform": "macOS"},
    )
    assert registered.status_code in {200, 201}, registered.text

    last = None
    for _ in range(WRITE_LIMIT + 2):
        last = await client.delete(
            f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", headers=_auth(alice)
        )
    assert last is not None
    assert last.status_code == 429, last.text


async def test_device_key_envelope_put_is_rate_limited(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    assert (await _commit(client, alice, vault_id)).status_code == 200
    assert (
        await _commit(
            client,
            alice,
            vault_id,
            revision=2,
            expectedRevision=1,
            envelopes=[_master_envelope(), _device_envelope(DEVICE_A)],
            sealedManifest=_sealed_manifest(),
        )
    ).status_code == 200

    # The path details do not matter here: the limiter runs before any of the
    # 404/409 checks, so a repeated call must end in 429 rather than an
    # unbounded stream of rejections.
    last = None
    for _ in range(WRITE_LIMIT + 2):
        last = await client.put(
            f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}"
            f"/credentials/does-not-exist/device-key-envelope?expectedRevision=2",
            headers=_auth(alice),
            json={
                "version": 1,
                "vaultId": vault_id,
                "deviceId": DEVICE_A,
                "credentialId": "does-not-exist",
                "deviceKeyVersion": 1,
                "encryption": "AES-256-GCM",
                "nonce": "AAAAAAAAAAAAAAAA",
                "ciphertext": "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg=",
                "tag": "CQkJCQkJCQkJCQkJCQkJCQ==",
            },
        )
    assert last is not None
    assert last.status_code == 429, last.text
