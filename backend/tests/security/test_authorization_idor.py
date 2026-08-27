"""Security-boundary tests: authorization / IDOR.

These tests exist so the API cannot claim a security property that it does
not actually implement. Device DELETE is metadata-only. WebAuthn fields are
client-asserted. Snapshot races must yield exactly one winner and a 409.
"""
from __future__ import annotations

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

# --- Authorization / IDOR ----------------------------------------------------


async def test_foreign_user_cannot_touch_vault_device_snapshot_or_envelope(client):
    _, alice = await _signup(client)
    _, bob = await _signup(client)
    vault_id = await _vault(client, alice)

    first = await _commit(
        client,
        alice,
        vault_id,
        envelopes=[_master_envelope(), _device_envelope(DEVICE_A)],
        sealedManifest=_sealed_manifest(),
    )
    assert first.status_code == 200, first.text

    registered = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": DEVICE_A, "label": "Alice laptop"},
    )
    assert registered.status_code == 200
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
    assert cred.json()["serverVerified"] is False
    assert cred.json()["verification"] == "client_asserted"

    put = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id),
        headers=_auth(alice),
        json=_dke(vault_id, DEVICE_A, cred_id),
    )
    assert put.status_code == 200, put.text

    paths = [
        ("GET", f"/api/v1/vaults/{vault_id}", None),
        ("GET", f"/api/v1/vaults/{vault_id}/snapshot", None),
        ("POST", f"/api/v1/vaults/{vault_id}/snapshots", {
            "revision": 2,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "envelopes": [_master_envelope()],
        }),
        ("GET", f"/api/v1/vaults/{vault_id}/devices", None),
        ("POST", f"/api/v1/vaults/{vault_id}/devices", {"deviceId": DEVICE_B, "label": "Bob"}),
        ("GET", f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", None),
        ("DELETE", f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", None),
        ("POST", f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials", {
            "credentialId": _cred_b64(),
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        }),
        ("GET", f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials/{_cred_path(cred_id)}/device-key-envelope", None),
        ("PUT", _dke_path(vault_id, DEVICE_A, cred_id),
         _dke(vault_id, DEVICE_A, cred_id)),
    ]
    for method, path, body in paths:
        response = await client.request(method, path, headers=_auth(bob), json=body)
        assert response.status_code == 404, f"{method} {path} -> {response.status_code} {response.text}"


async def test_create_vault_ignores_owner_override_in_query_and_has_no_body(client):
    _, alice = await _signup(client)
    _, bob = await _signup(client)
    bob_id = (await client.get("/api/v1/auth/me", headers=_auth(bob))).json()["id"]
    created = await client.post(
        f"/api/v1/vaults?owner_user_id={bob_id}&user_id={bob_id}",
        headers=_auth(alice),
        json={"ownerUserId": bob_id, "userId": bob_id, "isAdmin": True},
    )
    # No request body is declared; extra JSON is ignored or rejected. Ownership
    # must still be Alice's.
    assert created.status_code in {201, 422}
    listed = await client.get("/api/v1/vaults", headers=_auth(alice))
    assert listed.status_code == 200
    if created.status_code == 201:
        assert created.json()["vaultId"] in {row["vaultId"] for row in listed.json()}
        foreign = await client.get(f"/api/v1/vaults/{created.json()['vaultId']}", headers=_auth(bob))
        assert foreign.status_code == 404


