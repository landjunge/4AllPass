import base64
import uuid

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASSWORD = "account-password-1234"
FOREIGN_VAULT = "11111111-1111-1111-1111-111111111111"


def _email() -> str:
    return f"sec-{uuid.uuid4().hex[:10]}@example.com"


async def _signup(client, email: str | None = None) -> dict[str, str]:
    email = email or _email()
    response = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    session = response.cookies["4allpass_session"]
    csrf = response.cookies["4allpass_csrf"]
    client.cookies.clear()
    return {
        "Cookie": f"4allpass_session={session}; 4allpass_csrf={csrf}",
        "X-CSRF-Token": csrf,
    }


def _manifest() -> dict:
    return {
        "version": 1,
        "encryption": "AES-256-GCM",
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQ==",
        "tag": "AgICAgICAgICAgICAgICAg==",
    }


def _master_envelope(vault_key_version: int = 1) -> dict:
    return {
        "version": 1,
        "type": "master",
        "vaultKeyVersion": vault_key_version,
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


def _device_envelope(device_id: str, vault_key_version: int = 1) -> dict:
    return {
        "version": 1,
        "type": "device",
        "vaultKeyVersion": vault_key_version,
        "encryption": "AES-256-GCM",
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        "tag": "AgICAgICAgICAgICAgICAg==",
        "deviceId": device_id,
        "deviceKeyVersion": 1,
    }


def _snapshot_body(revision: int, expected: int | None = None, **overrides) -> dict:
    body = {
        "revision": revision,
        "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 1,
        "manifest": _manifest(),
        "envelopes": [_master_envelope()],
        "entries": [],
    }
    if expected is not None:
        body["expectedRevision"] = expected
    body.update(overrides)
    return body


def _path_id(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


async def _vault(client, headers: dict[str, str]) -> str:
    created = await client.post("/api/v1/vaults", headers=headers)
    assert created.status_code == 201, created.text
    return created.json()["vaultId"]


async def test_idor_cannot_touch_foreign_vault_device_snapshot_or_envelope(client):
    alice = await _signup(client)
    bob = await _signup(client)
    vault_id = await _vault(client, alice)
    device_id = "dev_alice_only"
    credential = b"credential-alice"
    registered = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=alice,
        json={"deviceId": device_id, "label": "Alice laptop"},
    )
    assert registered.status_code == 200, registered.text
    cred = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials",
        headers=alice,
        json={
            "credentialId": base64.b64encode(credential).decode("ascii"),
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert cred.status_code == 200, cred.text
    assert cred.json()["serverVerified"] is False
    envelope = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_path_id(credential)}/device-key-envelope",
        headers=alice,
        json={
            "version": 1,
            "vaultId": vault_id,
            "deviceId": device_id,
            "credentialId": base64.b64encode(credential).decode("ascii"),
            "deviceKeyVersion": 1,
            "encryption": "AES-256-GCM",
            "nonce": "AAAAAAAAAAAAAAAA",
            "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
            "tag": "AgICAgICAgICAgICAgICAg==",
        },
    )
    assert envelope.status_code == 200, envelope.text
    committed = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=alice,
        json=_snapshot_body(1),
    )
    assert committed.status_code == 200, committed.text

    for method, path, json_body in (
        ("GET", f"/api/v1/vaults/{vault_id}", None),
        ("GET", f"/api/v1/vaults/{vault_id}/snapshot", None),
        ("POST", f"/api/v1/vaults/{vault_id}/snapshots", _snapshot_body(2, expected=1)),
        ("GET", f"/api/v1/vaults/{vault_id}/devices", None),
        ("POST", f"/api/v1/vaults/{vault_id}/devices", {"deviceId": "dev_bob"}),
        ("GET", f"/api/v1/vaults/{vault_id}/devices/{device_id}", None),
        ("DELETE", f"/api/v1/vaults/{vault_id}/devices/{device_id}", None),
        (
            "POST",
            f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials",
            {
                "credentialId": base64.b64encode(b"bob").decode("ascii"),
                "rpId": "localhost",
                "mechanism": "prf",
                "prfSupported": True,
                "largeBlobSupported": False,
            },
        ),
        (
            "GET",
            f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_path_id(credential)}/device-key-envelope",
            None,
        ),
        (
            "PUT",
            f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_path_id(credential)}/device-key-envelope",
            {
                "version": 1,
                "vaultId": vault_id,
                "deviceId": device_id,
                "credentialId": base64.b64encode(credential).decode("ascii"),
                "deviceKeyVersion": 1,
                "encryption": "AES-256-GCM",
                "nonce": "AAAAAAAAAAAAAAAA",
                "ciphertext": "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=",
                "tag": "AwMDAwMDAwMDAwMDAwMDAw==",
            },
        ),
    ):
        response = await client.request(method, path, headers=bob, json=json_body)
        assert response.status_code == 404, (method, path, response.status_code, response.text)

    missing = await client.get(f"/api/v1/vaults/{FOREIGN_VAULT}", headers=alice)
    assert missing.status_code == 404


async def test_mass_assignment_cannot_override_server_state(client):
    alice = await _signup(client)
    vault_id = await _vault(client, alice)
    rejected = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=alice,
        json={
            "deviceId": "dev_mass",
            "ownerUserId": str(uuid.uuid4()),
            "revokedAt": None,
            "cryptoVersion": 99,
        },
    )
    assert rejected.status_code == 422

    snapshot = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=alice,
        json=_snapshot_body(1) | {"ownerUserId": str(uuid.uuid4()), "isAdmin": True},
    )
    assert snapshot.status_code == 422


async def test_snapshot_rejects_key_version_downgrade_and_mismatch(client):
    alice = await _signup(client)
    vault_id = await _vault(client, alice)
    first = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=alice,
        json=_snapshot_body(1, vaultKeyVersion=2, envelopes=[_master_envelope(2)]),
    )
    assert first.status_code == 200, first.text
    downgrade = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=alice,
        json=_snapshot_body(2, expected=1, vaultKeyVersion=1, envelopes=[_master_envelope(1)]),
    )
    assert downgrade.status_code == 422
    mismatch = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=alice,
        json=_snapshot_body(2, expected=1, vaultKeyVersion=2, envelopes=[_master_envelope(1)]),
    )
    assert mismatch.status_code == 422


async def test_device_registration_is_metadata_not_webauthn_proof(client):
    alice = await _signup(client)
    vault_id = await _vault(client, alice)
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=alice,
        json={"deviceId": "dev_meta", "label": "claimed"},
    )
    foreign_rp = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/dev_meta/credentials",
        headers=alice,
        json={
            "credentialId": base64.b64encode(b"cred-meta").decode("ascii"),
            "rpId": "evil.example",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert foreign_rp.status_code == 422

    accepted = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/dev_meta/credentials",
        headers=alice,
        json={
            "credentialId": base64.b64encode(b"cred-meta").decode("ascii"),
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert accepted.status_code == 200
    body = accepted.json()
    assert body["prfSupported"] is True
    assert body["serverVerified"] is False


async def test_envelope_identity_and_revocation_boundaries(client):
    alice = await _signup(client)
    vault_id = await _vault(client, alice)
    device_id = "dev_bound"
    other = "dev_other"
    credential = b"cred-bound"
    other_cred = b"cred-other"
    for name in (device_id, other):
        assert (
            await client.post(
                f"/api/v1/vaults/{vault_id}/devices",
                headers=alice,
                json={"deviceId": name},
            )
        ).status_code == 200
    for name, raw in ((device_id, credential), (other, other_cred)):
        assert (
            await client.post(
                f"/api/v1/vaults/{vault_id}/devices/{name}/credentials",
                headers=alice,
                json={
                    "credentialId": base64.b64encode(raw).decode("ascii"),
                    "rpId": "localhost",
                    "mechanism": "prf",
                    "prfSupported": True,
                    "largeBlobSupported": False,
                },
            )
        ).status_code == 200

    swapped = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_path_id(credential)}/device-key-envelope",
        headers=alice,
        json={
            "version": 1,
            "vaultId": vault_id,
            "deviceId": other,
            "credentialId": base64.b64encode(credential).decode("ascii"),
            "deviceKeyVersion": 1,
            "encryption": "AES-256-GCM",
            "nonce": "AAAAAAAAAAAAAAAA",
            "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
            "tag": "AgICAgICAgICAgICAgICAg==",
        },
    )
    assert swapped.status_code == 422

    wrong_cred = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_path_id(other_cred)}/device-key-envelope",
        headers=alice,
        json={
            "version": 1,
            "vaultId": vault_id,
            "deviceId": device_id,
            "credentialId": base64.b64encode(other_cred).decode("ascii"),
            "deviceKeyVersion": 1,
            "encryption": "AES-256-GCM",
            "nonce": "AAAAAAAAAAAAAAAA",
            "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
            "tag": "AgICAgICAgICAgICAgICAg==",
        },
    )
    assert wrong_cred.status_code == 404

    stored = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_path_id(credential)}/device-key-envelope",
        headers=alice,
        json={
            "version": 1,
            "vaultId": vault_id,
            "deviceId": device_id,
            "credentialId": base64.b64encode(credential).decode("ascii"),
            "deviceKeyVersion": 1,
            "encryption": "AES-256-GCM",
            "nonce": "AAAAAAAAAAAAAAAA",
            "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
            "tag": "AgICAgICAgICAgICAgICAg==",
        },
    )
    assert stored.status_code == 200, stored.text

    first = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=alice,
        json=_snapshot_body(1, envelopes=[_master_envelope(), _device_envelope(device_id)]),
    )
    assert first.status_code == 200, first.text
    assert first.json()["vaultKeyVersion"] == 1

    revoked = await client.delete(f"/api/v1/vaults/{vault_id}/devices/{device_id}", headers=alice)
    assert revoked.status_code == 200
    assert revoked.json()["revokedAt"]
    assert revoked.json()["hasDeviceEnvelope"] is True

    blocked_envelope = await client.get(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_path_id(credential)}/device-key-envelope",
        headers=alice,
    )
    assert blocked_envelope.status_code == 410

    blocked_put = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device_id}/credentials/{_path_id(credential)}/device-key-envelope",
        headers=alice,
        json={
            "version": 1,
            "vaultId": vault_id,
            "deviceId": device_id,
            "credentialId": base64.b64encode(credential).decode("ascii"),
            "deviceKeyVersion": 2,
            "encryption": "AES-256-GCM",
            "nonce": "AAAAAAAAAAAAAAAA",
            "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
            "tag": "AgICAgICAgICAgICAgICAg==",
        },
    )
    assert blocked_put.status_code == 410

    resurrect = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=alice,
        json={"deviceId": device_id, "label": "back"},
    )
    assert resurrect.status_code == 409

    reattach = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=alice,
        json=_snapshot_body(
            2,
            expected=1,
            envelopes=[_master_envelope(), _device_envelope(device_id)],
        ),
    )
    assert reattach.status_code == 422

    dropped = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=alice,
        json=_snapshot_body(2, expected=1),
    )
    assert dropped.status_code == 200, dropped.text
    assert dropped.json()["vaultKeyVersion"] == 1
    assert all(env["type"] != "device" for env in dropped.json()["envelopes"])
    listed = await client.get(f"/api/v1/vaults/{vault_id}/devices", headers=alice)
    target = next(device for device in listed.json() if device["deviceId"] == device_id)
    assert target["revokedAt"]
    assert target["hasDeviceEnvelope"] is False


async def test_snapshot_preserves_opaque_manifest_bytes(client):
    alice = await _signup(client)
    vault_id = await _vault(client, alice)
    manifest = {
        "version": 1,
        "encryption": "AES-256-GCM",
            "nonce": "QEBAQEBAQEBAQEBAQEBAQA==",
        "ciphertext": "Zm9yLW1hbmlmZXN0LWJ5dGVzLW9ubHk=",
        "tag": "RERERERERERERERERERERA==",
    }
    committed = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=alice,
        json=_snapshot_body(1, manifest=manifest),
    )
    assert committed.status_code == 200, committed.text
    assert committed.json()["manifest"] == manifest
    fetched = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=alice)
    assert fetched.json()["manifest"] == manifest
    assert "password" not in fetched.text
