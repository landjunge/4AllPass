"""Server-side security boundary: auth, IDOR, revocation, CAS, mass assignment.

These tests assert what the backend actually enforces. They do not claim
cryptographic properties the server cannot provide (it never holds VK).
"""

from __future__ import annotations

import asyncio
import base64
import uuid

import pytest

from app.core.security import new_session_token
from app.core.sessions import SessionRecord, get_session_store

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASSWORD = "account-password-1234"


def _email() -> str:
    return f"sec-{uuid.uuid4().hex[:10]}@example.com"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _manifest(ciphertext: bytes | None = None) -> dict:
    return {
        "version": 1,
        "encryption": "AES-256-GCM",
        "nonce": _b64(b"\x00" * 12),
        "ciphertext": _b64(ciphertext or b"\x11" * 32),
        "tag": _b64(b"\x22" * 16),
    }


def _master_envelope() -> dict:
    return {
        "version": 1,
        "type": "master",
        "vaultKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": _b64(b"\x00" * 12),
        "ciphertext": _b64(b"\x01" * 32),
        "tag": _b64(b"\x02" * 16),
        "kdf": {
            "algorithm": "argon2id",
            "version": 19,
            "memory": 65536,
            "iterations": 3,
            "parallelism": 4,
            "hashLen": 32,
            "salt": _b64(b"\x03" * 16),
        },
    }


def _device_envelope(device_id: str) -> dict:
    return {
        "version": 1,
        "type": "device",
        "vaultKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": _b64(b"\x00" * 12),
        "ciphertext": _b64(b"\x04" * 32),
        "tag": _b64(b"\x05" * 16),
        "deviceId": device_id,
        "deviceKeyVersion": 1,
    }


def _entry(entry_id: str = "entry-1", ciphertext: bytes | None = None) -> dict:
    return {
        "id": entry_id,
        "schemaVersion": 1,
        "cryptoVersion": 1,
        "vaultKeyVersion": 1,
        "nonce": _b64(b"\x00" * 12),
        "ciphertext": _b64(ciphertext or b"opaque-entry-bytes"),
        "tag": _b64(b"\x06" * 16),
    }


def _snapshot_body(
    revision: int,
    *,
    expected: int | None = None,
    envelopes: list[dict] | None = None,
    entries: list[dict] | None = None,
    vault_key_version: int = 1,
    manifest: dict | None = None,
) -> dict:
    body = {
        "revision": revision,
        "vaultKeyVersion": vault_key_version,
        "cryptoProtocolVersion": 1,
        "envelopes": envelopes if envelopes is not None else [_master_envelope()],
        "entries": entries if entries is not None else [],
        "manifest": manifest if manifest is not None else _manifest(),
    }
    if expected is not None:
        body["expectedRevision"] = expected
    return body


async def _signup(client, email: str | None = None) -> tuple[str, str, str]:
    email = email or _email()
    response = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    body = response.json()
    return email, body["token"], body["accountId"]


async def _vault(client, token: str) -> str:
    created = await client.post("/api/v1/vaults", headers=_auth(token))
    assert created.status_code == 201, created.text
    return created.json()["vaultId"]


async def _commit(client, token: str, vault_id: str, body: dict):
    return await client.post(f"/api/v1/vaults/{vault_id}/snapshots", headers=_auth(token), json=body)


# --- Auth / session lifecycle -------------------------------------------------


async def test_register_login_logout_and_token_reuse(client):
    email, token, account_id = await _signup(client)
    me = await client.get("/api/v1/auth/me", headers=_auth(token))
    assert me.status_code == 200
    assert me.json()["email"] == email
    assert me.json()["id"] == account_id
    assert "token" not in me.json()
    assert "accountPasswordHash" not in me.json()
    assert "password" not in me.json()

    logout = await client.post("/api/v1/auth/logout", headers=_auth(token))
    assert logout.status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=_auth(token))).status_code == 401


async def test_invalid_and_expired_session(client):
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=_auth("not-a-real-token"))).status_code == 401

    email, token, account_id = await _signup(client)
    store = get_session_store()
    expired = new_session_token()
    await store.put(expired, SessionRecord(user_id=uuid.UUID(account_id), email=email), ttl_seconds=0)
    await asyncio.sleep(0.02)
    assert (await client.get("/api/v1/auth/me", headers=_auth(expired))).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=_auth(token))).status_code == 200


async def test_concurrent_sessions_are_independent(client):
    email, first, _ = await _signup(client)
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    second = login.json()["token"]
    assert first != second
    assert (await client.get("/api/v1/auth/me", headers=_auth(first))).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=_auth(second))).status_code == 200
    await client.post("/api/v1/auth/logout", headers=_auth(first))
    assert (await client.get("/api/v1/auth/me", headers=_auth(first))).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=_auth(second))).status_code == 200


async def test_login_rate_limit(client):
    email, _, _ = await _signup(client)
    for _ in range(10):
        response = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": "definitely-wrong-password"}
        )
        assert response.status_code == 401
    tripped = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": "definitely-wrong-password"}
    )
    assert tripped.status_code == 429


async def test_register_rejects_mass_assignment(client):
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": _email(),
            "password": PASSWORD,
            "isAdmin": True,
            "ownerUserId": str(uuid.uuid4()),
            "accountPasswordHash": "x",
        },
    )
    assert response.status_code == 422


# --- Authorization / IDOR ----------------------------------------------------


async def test_user_cannot_touch_foreign_vault_device_snapshot_or_envelope(client):
    _, alice, _ = await _signup(client)
    _, bob, _ = await _signup(client)
    vault_id = await _vault(client, alice)
    device_id = "dev_alice_one"
    cred = uuid.uuid4().bytes

    created = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": device_id, "label": "Alice laptop"},
    )
    assert created.status_code == 200
    cred_reg = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials",
        headers=_auth(alice),
        json={
            "credentialId": _b64(cred),
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert cred_reg.status_code == 200, cred_reg.text

    envelope = {
        "version": 1,
        "vaultId": vault_id,
        "deviceId": device_id,
        "credentialId": _b64(cred),
        "deviceKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": _b64(b"\x00" * 12),
        "ciphertext": _b64(b"\x07" * 32),
        "tag": _b64(b"\x08" * 16),
    }
    put = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_b64url(cred)}/device-key-envelope",
        headers=_auth(alice),
        json=envelope,
    )
    assert put.status_code == 200, put.text

    first = await _commit(client, alice, vault_id, _snapshot_body(1))
    assert first.status_code == 200, first.text

    for method, path in (
        ("GET", f"/api/v1/vaults/{vault_id}"),
        ("GET", f"/api/v1/vaults/{vault_id}/snapshot"),
        ("GET", f"/api/v1/vaults/{vault_id}/devices"),
        ("GET", f"/api/v1/vaults/{vault_id}/devices/{device_id}"),
        (
            "GET",
            f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_b64url(cred)}/device-key-envelope",
        ),
    ):
        response = await client.request(method, path, headers=_auth(bob))
        assert response.status_code == 404, (path, response.text)

    steal_snapshot = await _commit(client, bob, vault_id, _snapshot_body(2, expected=1))
    assert steal_snapshot.status_code == 404

    steal_device = await client.delete(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}", headers=_auth(bob)
    )
    assert steal_device.status_code == 404

    steal_cred = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials",
        headers=_auth(bob),
        json={
            "credentialId": _b64(bytes(range(16, 32))),
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert steal_cred.status_code == 404

    steal_env = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_b64url(cred)}/device-key-envelope",
        headers=_auth(bob),
        json=envelope,
    )
    assert steal_env.status_code == 404


async def test_forged_ids_do_not_bypass_ownership(client):
    _, alice, _ = await _signup(client)
    forged_vault = str(uuid.uuid4())
    assert (await client.get(f"/api/v1/vaults/{forged_vault}", headers=_auth(alice))).status_code == 404
    assert (
        await client.get(f"/api/v1/vaults/{forged_vault}/devices/dev_x", headers=_auth(alice))
    ).status_code == 404


async def test_create_vault_cannot_assign_foreign_owner(client):
    _, alice, _ = await _signup(client)
    _, bob, _ = await _signup(client)
    created = await client.post(
        "/api/v1/vaults",
        headers=_auth(alice),
        json={"ownerUserId": str(uuid.uuid4())},
    )
    assert created.status_code == 201
    vault_id = created.json()["vaultId"]
    assert (await client.get(f"/api/v1/vaults/{vault_id}", headers=_auth(bob))).status_code == 404
    assert (await client.get(f"/api/v1/vaults/{vault_id}", headers=_auth(alice))).status_code == 200


# --- Snapshot CAS / atomicity / manifest bytes --------------------------------


async def test_snapshot_requires_manifest_and_preserves_bytes(client):
    _, alice, _ = await _signup(client)
    vault_id = await _vault(client, alice)
    ciphertext = b"entry-ciphertext-must-roundtrip"
    manifest_ct = b"manifest-ciphertext-must-roundtrip"
    body = _snapshot_body(
        1,
        entries=[_entry("alpha", ciphertext)],
        manifest=_manifest(manifest_ct),
    )
    missing = dict(body)
    missing.pop("manifest")
    assert (await _commit(client, alice, vault_id, missing)).status_code == 422

    written = await _commit(client, alice, vault_id, body)
    assert written.status_code == 200, written.text
    fetched = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))
    assert fetched.status_code == 200
    data = fetched.json()
    assert data["revision"] == 1
    assert data["entries"][0]["ciphertext"] == _b64(ciphertext)
    assert data["manifest"]["ciphertext"] == _b64(manifest_ct)
    assert data["envelopes"][0]["ciphertext"] == _master_envelope()["ciphertext"]


async def test_stale_and_concurrent_revision_conflict(client):
    _, alice, _ = await _signup(client)
    vault_id = await _vault(client, alice)
    first = await _commit(client, alice, vault_id, _snapshot_body(1))
    assert first.status_code == 200, first.text

    stale = await _commit(client, alice, vault_id, _snapshot_body(1, expected=0))
    assert stale.status_code == 409
    assert stale.json()["currentRevision"] == 1

    a = _snapshot_body(2, expected=1, manifest=_manifest(b"client-a"))
    b = _snapshot_body(2, expected=1, manifest=_manifest(b"client-b"))
    first_race, second_race = await asyncio.gather(
        _commit(client, alice, vault_id, a),
        _commit(client, alice, vault_id, b),
    )
    statuses = sorted([first_race.status_code, second_race.status_code])
    assert statuses == [200, 409], (first_race.text, second_race.text)
    winner = first_race if first_race.status_code == 200 else second_race
    loser = second_race if first_race.status_code == 200 else first_race
    assert loser.json()["currentRevision"] == 2
    fetched = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))
    assert fetched.json()["revision"] == 2
    assert fetched.json()["manifest"]["ciphertext"] == winner.json()["manifest"]["ciphertext"]


async def test_vault_key_version_cannot_decrease_or_skip(client):
    _, alice, _ = await _signup(client)
    vault_id = await _vault(client, alice)
    assert (await _commit(client, alice, vault_id, _snapshot_body(1))).status_code == 200
    down = await _commit(
        client, alice, vault_id, _snapshot_body(2, expected=1, vault_key_version=1)
    )
    # same version is a normal edit
    assert down.status_code == 200, down.text
    skip = await _commit(
        client, alice, vault_id, _snapshot_body(3, expected=2, vault_key_version=3)
    )
    assert skip.status_code == 422
    rotate = await _commit(
        client, alice, vault_id, _snapshot_body(3, expected=2, vault_key_version=2)
    )
    assert rotate.status_code == 200, rotate.text


async def test_snapshot_rejects_mass_assignment_and_missing_master(client):
    _, alice, _ = await _signup(client)
    vault_id = await _vault(client, alice)
    extra = _snapshot_body(1)
    extra["ownerUserId"] = str(uuid.uuid4())
    extra["revokedAt"] = None
    extra["isAdmin"] = True
    assert (await _commit(client, alice, vault_id, extra)).status_code == 422

    no_master = _snapshot_body(1, envelopes=[_device_envelope("dev_x")])
    assert (await _commit(client, alice, vault_id, no_master)).status_code == 422


# --- Device revocation semantics ---------------------------------------------


async def test_revoked_device_is_metadata_not_cryptographic_erasure(client):
    _, alice, _ = await _signup(client)
    vault_id = await _vault(client, alice)
    device_id = "dev_to_revoke"
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": device_id, "label": "phone"},
    )
    committed = await _commit(
        client,
        alice,
        vault_id,
        _snapshot_body(1, envelopes=[_master_envelope(), _device_envelope(device_id)]),
    )
    assert committed.status_code == 200, committed.text

    revoked = await client.delete(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}", headers=_auth(alice)
    )
    assert revoked.status_code == 200
    assert revoked.json()["revokedAt"] is not None

    # DELETE does not rewrite the active snapshot. The device envelope is
    # still there — this is bookkeeping, not cryptographic revocation.
    current = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))
    types = [env["type"] for env in current.json()["envelopes"]]
    assert "device" in types

    blocked = await _commit(
        client,
        alice,
        vault_id,
        _snapshot_body(
            2,
            expected=1,
            envelopes=[_master_envelope(), _device_envelope(device_id)],
        ),
    )
    assert blocked.status_code == 422
    assert "revoked" in blocked.json()["detail"]

    cred = uuid.uuid4().bytes
    cred_blocked = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials",
        headers=_auth(alice),
        json={
            "credentialId": _b64(cred),
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert cred_blocked.status_code == 409

    # Soft revoke completes when the next snapshot omits the device envelope.
    soft = await _commit(
        client, alice, vault_id, _snapshot_body(2, expected=1, envelopes=[_master_envelope()])
    )
    assert soft.status_code == 200, soft.text
    after = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))
    assert all(env["type"] != "device" for env in after.json()["envelopes"])


async def test_device_envelope_identity_must_match_path(client):
    _, alice, _ = await _signup(client)
    vault_id = await _vault(client, alice)
    other_vault = await _vault(client, alice)
    device_id = "dev_env"
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={"deviceId": device_id, "label": "box"},
    )
    cred = uuid.uuid4().bytes
    registered = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials",
        headers=_auth(alice),
        json={
            "credentialId": _b64(cred),
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert registered.status_code == 200, registered.text
    mismatch = {
        "version": 1,
        "vaultId": other_vault,
        "deviceId": device_id,
        "credentialId": _b64(cred),
        "deviceKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": _b64(b"\x00" * 12),
        "ciphertext": _b64(b"\x07" * 32),
        "tag": _b64(b"\x08" * 16),
    }
    response = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_b64url(cred)}/device-key-envelope",
        headers=_auth(alice),
        json=mismatch,
    )
    assert response.status_code == 422

    wrong_cred = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_b64url(bytes(range(16, 32)))}/device-key-envelope",
        headers=_auth(alice),
        json={**mismatch, "vaultId": vault_id, "credentialId": _b64(cred)},
    )
    assert wrong_cred.status_code == 404


async def test_device_register_rejects_mass_assignment(client):
    _, alice, _ = await _signup(client)
    vault_id = await _vault(client, alice)
    response = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(alice),
        json={
            "deviceId": "dev_mass",
            "label": "x",
            "ownerUserId": str(uuid.uuid4()),
            "revokedAt": None,
            "vaultId": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 422
