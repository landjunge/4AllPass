"""AP-E03-P04-REVOKED-WRITES-v1 — revoked device rows block mutations only.

Contract under test (interim, ADR-015 §3 stays open):

- A session whose device id has a revoked ``Device`` row in *this* vault may
  read the vault and its revisions (recovery), but must not mutate anything:
  snapshot commit, device re-enrol, device revoke, credentials, Device-Key
  Envelope, WebAuthn challenges.
- Ownership still wins: a foreign vault is 404, not 403.
- A device without a row (legacy / newly claimed id) still writes — that
  remaining bearer-only gap is deliberate here.
- Revocation is scoped to one vault: the same id may still write another vault
  of the same account.
- Self-revoke is allowed (the row is still active at that moment); the next
  call from that session is denied.
"""
from __future__ import annotations

import pytest

from tests.security.helpers import (
    DEVICE_A,
    DEVICE_B,
    PASSWORD,
    _auth,
    _commit,
    _cred_b64,
    _dke,
    _dke_path,
    _device_envelope,
    _email,
    _master_envelope,
    _sealed_manifest,
    _signup,
    _vault,
)

DEVICE_C = "dev_cccccccccccccccccccccccc"
DEVICE_NEW = "dev_nnnnnnnnnnnnnnnnnnnnnnnn"

# Same session-scoped loop as the other security suites: the Postgres engine
# pool is bound to the session loop (pytest.ini: default fixture loop scope).
pytestmark = pytest.mark.asyncio(loop_scope="session")


def _h(token: str, device_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Device-Id": device_id}


async def _login(client, email: str, device_id: str) -> str:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": PASSWORD},
        headers={"X-Device-Id": device_id},
    )
    assert response.status_code == 200, response.text
    return response.json()["token"]


async def _commit_as(client, token: str, device_id: str, vault_id: str, **overrides):
    body = {
        "revision": 1,
        "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 1,
        "envelopes": [_master_envelope()],
        "entries": [],
    }
    body.update(overrides)
    return await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=_h(token, device_id),
        json=body,
    )


async def _vault_with_revoked_device(client):
    """Owner keeps the default test device; DEVICE_A gets a row, a session, then revoke."""
    email, owner = await _signup(client)
    vault_id = await _vault(client, owner)
    first = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=_auth(owner),
        json={
            "revision": 1,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "envelopes": [_master_envelope(), _device_envelope(DEVICE_A)],
            "entries": [],
        },
    )
    assert first.status_code == 200, first.text
    registered = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(owner),
        json={"deviceId": DEVICE_A, "label": "Revoked phone"},
    )
    assert registered.status_code == 200, registered.text
    device_token = await _login(client, email, DEVICE_A)
    revoked = await client.delete(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", headers=_auth(owner)
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["revocation"] == "metadata_only"
    return email, owner, vault_id, device_token


async def test_revoked_device_cannot_commit_after_relogin(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)

    # Login itself is intentionally unchanged: it must still mint a session.
    relogged = await _login(client, email, DEVICE_A)

    denied = await _commit_as(
        client,
        relogged,
        DEVICE_A,
        vault_id,
        revision=2,
        sealedManifest=_sealed_manifest(),
    )
    assert denied.status_code == 403, denied.text
    assert denied.json()["detail"] == "device is revoked for this vault"

    # The denied call consumed no revision: the owner can still commit N+1.
    owner_commit = await _commit(
        client,
        owner,
        vault_id,
        revision=2,
        sealedManifest=_sealed_manifest(),
    )
    assert owner_commit.status_code == 200, owner_commit.text


async def test_revoked_device_cannot_reenrol_itself(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    relogged = await _login(client, email, DEVICE_A)

    again = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_h(relogged, DEVICE_A),
        json={"deviceId": DEVICE_A, "label": "Un-revoke attempt"},
    )
    assert again.status_code == 403, again.text
    assert again.json()["detail"] == "device is revoked for this vault"

    # It is still revoked on the server.
    listed = await client.get(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", headers=_auth(owner)
    )
    assert listed.status_code == 200
    assert listed.json()["revokedAt"] is not None


async def test_revoked_device_cannot_mutate_credentials_envelope_or_challenges(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    relogged = await _login(client, email, DEVICE_A)
    cred_id = _cred_b64()

    credential = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=_h(relogged, DEVICE_A),
        json={
            "credentialId": cred_id,
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert credential.status_code == 403, credential.text

    envelope = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id),
        headers=_h(relogged, DEVICE_A),
        json=_dke(vault_id, DEVICE_A, cred_id),
    )
    assert envelope.status_code == 403, envelope.text

    challenge = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges",
        headers=_h(relogged, DEVICE_A),
        json={"purpose": "create", "deviceId": DEVICE_A},
    )
    assert challenge.status_code == 403, challenge.text

    revoke_again = await client.delete(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_B}", headers=_h(relogged, DEVICE_A)
    )
    assert revoke_again.status_code == 403, revoke_again.text


async def test_revoked_device_keeps_read_and_recovery(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    relogged = await _login(client, email, DEVICE_A)

    snapshot = await client.get(
        f"/api/v1/vaults/{vault_id}/snapshot", headers=_h(relogged, DEVICE_A)
    )
    assert snapshot.status_code == 200, snapshot.text
    assert snapshot.json()["revision"] == 1

    revisions = await client.get(
        f"/api/v1/vaults/{vault_id}/revisions", headers=_h(relogged, DEVICE_A)
    )
    assert revisions.status_code == 200, revisions.text

    historic = await client.get(
        f"/api/v1/vaults/{vault_id}/revisions/1", headers=_h(relogged, DEVICE_A)
    )
    assert historic.status_code == 200, historic.text


async def test_active_other_device_and_unregistered_id_can_write(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)

    # A registered, active device row is unaffected.
    assert (
        await client.post(
            f"/api/v1/vaults/{vault_id}/devices",
            headers=_auth(owner),
            json={"deviceId": DEVICE_B, "label": "Active tablet"},
        )
    ).status_code == 200
    active_token = await _login(client, email, DEVICE_B)
    active_commit = await _commit_as(
        client,
        active_token,
        DEVICE_B,
        vault_id,
        revision=2,
        sealedManifest=_sealed_manifest(),
    )
    assert active_commit.status_code == 200, active_commit.text

    # No row at all (legacy / newly claimed id) still writes: the bearer-only
    # gap stays open on purpose until ADR-015 §3 (signed writes).
    new_token = await _login(client, email, DEVICE_NEW)
    new_commit = await _commit_as(
        client,
        new_token,
        DEVICE_NEW,
        vault_id,
        revision=3,
        sealedManifest=_sealed_manifest(),
    )
    assert new_commit.status_code == 200, new_commit.text


async def test_revoke_scope_is_per_vault(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    other_vault = await _vault(client, owner)
    relogged = await _login(client, email, DEVICE_A)

    # DEVICE_A has no row in the second vault, so it may still write there.
    written = await _commit_as(client, relogged, DEVICE_A, other_vault)
    assert written.status_code == 200, written.text


async def test_foreign_vault_remains_404(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    _, stranger = await _signup(client, _email())
    foreign_vault = await _vault(client, stranger)
    relogged = await _login(client, email, DEVICE_A)

    denied = await _commit_as(client, relogged, DEVICE_A, foreign_vault)
    assert denied.status_code == 404, denied.text


async def test_self_revoke_is_allowed_then_followup_is_denied(client):
    email, owner = await _signup(client)
    vault_id = await _vault(client, owner)
    assert (
        await client.post(
            f"/api/v1/vaults/{vault_id}/devices",
            headers=_auth(owner),
            json={"deviceId": DEVICE_C, "label": "Self revoking"},
        )
    ).status_code == 200
    token = await _login(client, email, DEVICE_C)
    assert (
        await _commit_as(client, token, DEVICE_C, vault_id)
    ).status_code == 200

    self_revoke = await client.delete(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_C}", headers=_h(token, DEVICE_C)
    )
    assert self_revoke.status_code == 200, self_revoke.text

    followup = await _commit_as(
        client,
        token,
        DEVICE_C,
        vault_id,
        revision=2,
        sealedManifest=_sealed_manifest(),
    )
    assert followup.status_code == 403, followup.text
