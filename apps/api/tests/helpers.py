import base64
import os


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def gcm_box() -> dict:
    """Random well-formed GCM fields. The server never verifies ciphertext."""
    return {
        "encryption": "AES-256-GCM",
        "nonce": b64(os.urandom(12)),
        "ciphertext": b64(os.urandom(48)),
        "tag": b64(os.urandom(16)),
    }


def master_envelope() -> dict:
    return {
        "version": 1,
        "type": "master",
        "kdf": {
            "algorithm": "argon2id",
            "version": 19,
            "memory": 65536,
            "iterations": 3,
            "parallelism": 4,
            "hash_len": 32,
            "salt": b64(os.urandom(16)),
        },
        **gcm_box(),
    }


def recovery_envelope() -> dict:
    return {"version": 1, "type": "recovery", **gcm_box()}


def device_envelope(device_id: str) -> dict:
    return {"version": 1, "type": "device", "device_id": device_id, **gcm_box()}


def entry(entry_id: str = "entry-1") -> dict:
    return {
        "id": entry_id,
        "schema_version": 1,
        "crypto_version": 1,
        **gcm_box(),
    }


def create_vault(client, name: str = "Test Vault") -> dict:
    r = client.post("/v1/vaults", json={"name": name, "user_email": "alice@example.com"})
    assert r.status_code == 201, r.text
    return r.json()


def commit_first_snapshot(client, vault_id: str, extra_envelopes: list[dict] | None = None) -> dict:
    body = {
        "expected_active_revision": None,
        "revision": 1,
        "vault_key_version": 1,
        "crypto_protocol_version": 1,
        "envelopes": [master_envelope(), recovery_envelope(), *(extra_envelopes or [])],
        "entries": [entry()],
    }
    r = client.post(f"/v1/vaults/{vault_id}/snapshots", json=body)
    assert r.status_code == 201, r.text
    return r.json()
