"""Security-boundary tests: auth, IDOR, devices, envelopes, snapshot CAS.

These tests exist so the API cannot claim a security property that it does
not actually implement. Device DELETE is metadata-only. WebAuthn fields are
client-asserted. Snapshot races must yield exactly one winner and a 409.
"""

from __future__ import annotations

import asyncio
import base64
import time
import uuid

import pytest

from app.core.security import token_lookup_key
from app.core.sessions import get_session_store

pytestmark = pytest.mark.asyncio(loop_scope="session")

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


# --- Auth / sessions ---------------------------------------------------------


async def test_me_does_not_leak_password_hash_or_oauth_fields(client):
    _, token = await _signup(client)
    me = await client.get("/api/v1/auth/me", headers=_auth(token))
    assert me.status_code == 200
    body = me.json()
    assert set(body) == {"id", "email", "createdAt"}
    joined = " ".join(str(v) for v in body.values()).lower()
    assert "argon2" not in joined
    assert "password" not in joined


async def test_invalid_and_expired_session_are_rejected(client):
    _, token = await _signup(client)
    bogus = await client.get("/api/v1/auth/me", headers=_auth("not-a-real-token"))
    assert bogus.status_code == 401

    store = get_session_store()
    key = token_lookup_key(token)
    expires_at, record = store._sessions[key]
    store._sessions[key] = (time.time() - 1, record)
    expired = await client.get("/api/v1/auth/me", headers=_auth(token))
    assert expired.status_code == 401
    assert expires_at > 0


async def test_logout_revokes_only_that_token_concurrent_sessions_survive(client):
    email, first = await _signup(client)
    second_login = await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert second_login.status_code == 200
    second = second_login.json()["token"]
    assert second != first

    assert (await client.get("/api/v1/auth/me", headers=_auth(first))).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=_auth(second))).status_code == 200

    logout = await client.post("/api/v1/auth/logout", headers=_auth(first))
    assert logout.status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=_auth(first))).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=_auth(second))).status_code == 200


async def test_x_user_id_header_cannot_spoof_the_session_user(client):
    _, alice = await _signup(client)
    _, bob = await _signup(client)
    bob_me = await client.get("/api/v1/auth/me", headers=_auth(bob))
    bob_id = bob_me.json()["id"]

    spoofed = await client.get(
        "/api/v1/auth/me",
        headers={**_auth(alice), "X-User-Id": bob_id, "X-Account-Id": bob_id},
    )
    assert spoofed.status_code == 200
    assert spoofed.json()["id"] != bob_id


async def test_login_rate_limit_trips(client):
    email, _ = await _signup(client)
    last = None
    for _ in range(11):
        last = await client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "definitely-wrong-password"},
        )
    assert last is not None
    assert last.status_code == 429


async def test_register_rejects_mass_assignment(client):
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": _email(),
            "password": PASSWORD,
            "isAdmin": True,
            "ownerUserId": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 422


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


async def test_inactive_user_cannot_use_a_live_token(client, engine):
    from sqlalchemy import update

    from app.models.user import User

    email, token = await _signup(client)
    async with engine.begin() as conn:
        await conn.execute(update(User).where(User.email == email).values(is_active=False))

    response = await client.get("/api/v1/auth/me", headers=_auth(token))
    assert response.status_code == 401


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


async def test_snapshot_rejects_oversized_ciphertext(client):
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    huge = "A" * 1_400_001
    response = await _commit(client, alice, vault_id, envelopes=[_master_envelope(ciphertext=huge)])
    assert response.status_code == 422
