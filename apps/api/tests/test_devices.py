"""Device registration, WebAuthn credential metadata, Device-Key Envelope mirror."""

import base64
import os

from app.core.redis import get_redis
from tests.helpers import (
    b64,
    commit_first_snapshot,
    create_vault,
    device_envelope,
)


def _register_device(client, vault_id: str) -> dict:
    r = client.post(
        f"/v1/vaults/{vault_id}/devices",
        json={"name": "Pixel 9 / Chrome", "user_agent_summary": "Chrome 139 Android"},
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_device_registration_and_device_envelope_in_snapshot(client):
    vault = create_vault(client)
    device = _register_device(client, vault["id"])

    snap = commit_first_snapshot(
        client, vault["id"], extra_envelopes=[device_envelope(device["id"])]
    )
    types = {e["type"] for e in snap["envelopes"]}
    assert types == {"master", "recovery", "device"}
    dev_env = next(e for e in snap["envelopes"] if e["type"] == "device")
    assert dev_env["device_id"] == device["id"]
    assert dev_env["kdf"] is None


def test_device_envelope_requires_device_id(client):
    vault = create_vault(client)
    bad = device_envelope("00000000-0000-0000-0000-000000000000")
    bad.pop("device_id")
    r = client.post(
        f"/v1/vaults/{vault['id']}/snapshots",
        json={
            "expected_active_revision": None,
            "revision": 1,
            "vault_key_version": 1,
            "envelopes": [bad],
        },
    )
    assert r.status_code == 422


def test_webauthn_credential_upsert(client):
    vault = create_vault(client)
    device = _register_device(client, vault["id"])
    credential_id = b64(os.urandom(32))

    r = client.put(
        f"/v1/devices/{device['id']}/webauthn-credential",
        json={
            "credential_id": credential_id,
            "public_key_cose": b64(os.urandom(77)),
            "rp_id": "pass.example.local",
            "transports": "internal",
            "unlock_mechanism": "prf",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["credential_id"] == credential_id
    # userVerification is always required in v1 (webauthn-prf.md §2, §7).
    assert body["uv_required"] is True
    assert body["unlock_mechanism"] == "prf"


def test_webauthn_credential_conflict_across_devices(client):
    vault = create_vault(client)
    device_a = _register_device(client, vault["id"])
    device_b = _register_device(client, vault["id"])
    credential_id = b64(os.urandom(32))
    payload = {"credential_id": credential_id, "rp_id": "pass.example.local"}

    r = client.put(f"/v1/devices/{device_a['id']}/webauthn-credential", json=payload)
    assert r.status_code == 201
    r = client.put(f"/v1/devices/{device_b['id']}/webauthn-credential", json=payload)
    assert r.status_code == 409


def test_device_key_envelope_mirror_roundtrip(client):
    """The opaque DK-under-DWK blob (webauthn-prf.md §4) survives PUT/GET."""
    vault = create_vault(client)
    device = _register_device(client, vault["id"])
    credential_id = b64(os.urandom(32))
    envelope = {
        "version": 1,
        "credential_id": credential_id,
        "encryption": "AES-256-GCM",
        "nonce": b64(os.urandom(12)),
        "ciphertext": b64(os.urandom(48)),
        "tag": b64(os.urandom(16)),
    }

    r = client.put(f"/v1/devices/{device['id']}/device-key-envelope", json=envelope)
    assert r.status_code == 201, r.text

    r = client.get(
        f"/v1/devices/{device['id']}/device-key-envelope",
        params={"credential_id": credential_id},
    )
    assert r.status_code == 200
    fetched = r.json()
    for field in ("credential_id", "nonce", "ciphertext", "tag"):
        assert fetched[field] == envelope[field]
    assert fetched["vault_id"] == vault["id"]
    assert fetched["device_id"] == device["id"]

    # Re-wrap after rotation: PUT with same (vault, device, credential) updates in place.
    envelope2 = dict(envelope, nonce=b64(os.urandom(12)), ciphertext=b64(os.urandom(48)))
    r = client.put(f"/v1/devices/{device['id']}/device-key-envelope", json=envelope2)
    assert r.status_code == 201
    r = client.get(
        f"/v1/devices/{device['id']}/device-key-envelope",
        params={"credential_id": credential_id},
    )
    assert r.json()["ciphertext"] == envelope2["ciphertext"]


def test_webauthn_challenge_stored_in_redis_with_ttl(client):
    r = client.post("/v1/webauthn/challenges")
    assert r.status_code == 200
    body = r.json()
    assert body["user_verification"] == "required"
    challenge = base64.b64decode(body["challenge"])
    assert len(challenge) == 32

    redis = get_redis()
    key = f"webauthn:challenge:{body['challenge_id']}"
    assert redis.get(key) == challenge
    ttl = redis.ttl(key)
    assert 0 < ttl <= body["expires_in_seconds"]
