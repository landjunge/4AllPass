"""Device metadata, WebAuthn credentials, and the opaque Device-Key mirror."""

import base64
import secrets

from app.schemas.wire import encode_base64url
from tests.conftest import Api, b64, device_envelope, master_envelope, snapshot

CREDENTIAL_ID_BYTES = bytes.fromhex("cafebabecafebabecafebabecafebabe")
CREDENTIAL_ID = base64.b64encode(CREDENTIAL_ID_BYTES).decode()


def credential(mechanism: str = "prf", **overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "credentialId": CREDENTIAL_ID,
        "rpId": "pass.example.local",
        "mechanism": mechanism,
        "prfSupported": mechanism == "prf",
        "largeBlobSupported": mechanism == "large_blob",
    }
    payload.update(overrides)
    return payload


def device_key_envelope(vault_id: str, device_id: str, **overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "version": 1,
        "vaultId": vault_id,
        "deviceId": device_id,
        "credentialId": CREDENTIAL_ID,
        "deviceKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": b64(12),
        "ciphertext": b64(32),
        "tag": b64(16),
    }
    payload.update(overrides)
    return payload


def mirror_path(vault_id: str, device_id: str, credential_id: bytes = CREDENTIAL_ID_BYTES) -> str:
    """Credential ids are base64url without padding in URL paths."""
    path_id = encode_base64url(credential_id)
    return f"/vaults/{vault_id}/devices/{device_id}/credentials/{path_id}/device-key-envelope"


async def add_device(account: Api, vault_id: str, device_id: str = "dev_chrome_1") -> str:
    response = await account.post(
        f"/vaults/{vault_id}/devices",
        {
            "deviceId": device_id,
            "label": "MacBook Chrome",
            "platform": "macos",
            "userAgentSummary": "Chrome on macOS",
        },
    )
    assert response.status_code == 201, response.text
    return device_id


async def test_register_device_is_idempotent(account: Api, vault_id: str) -> None:
    await add_device(account, vault_id)
    again = await account.post(
        f"/vaults/{vault_id}/devices", {"deviceId": "dev_chrome_1", "label": "Renamed"}
    )
    assert again.status_code == 201
    devices = (await account.get(f"/vaults/{vault_id}/devices")).json()
    assert len(devices) == 1
    assert devices[0]["label"] == "Renamed"
    assert devices[0]["hasDeviceEnvelope"] is False


async def test_credential_metadata_round_trip(account: Api, vault_id: str) -> None:
    device_id = await add_device(account, vault_id)
    response = await account.post(
        f"/vaults/{vault_id}/devices/{device_id}/credentials", credential()
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["mechanism"] == "prf"
    assert body["userVerificationRequired"] is True
    assert body["hasMirroredDeviceKeyEnvelope"] is False
    assert body["credentialId"] == CREDENTIAL_ID


async def test_prf_device_key_envelope_is_mirrored(account: Api, vault_id: str) -> None:
    device_id = await add_device(account, vault_id)
    await account.post(f"/vaults/{vault_id}/devices/{device_id}/credentials", credential())

    payload = device_key_envelope(vault_id, device_id)
    stored = await account.put(mirror_path(vault_id, device_id), payload)
    assert stored.status_code == 200, stored.text
    assert stored.json()["ciphertext"] == payload["ciphertext"]

    fetched = await account.get(mirror_path(vault_id, device_id))
    assert fetched.status_code == 200
    assert fetched.json() == stored.json()

    devices = (await account.get(f"/vaults/{vault_id}/devices")).json()
    assert devices[0]["credentials"][0]["hasMirroredDeviceKeyEnvelope"] is True


async def test_mirror_is_overwritten_not_duplicated(account: Api, vault_id: str) -> None:
    device_id = await add_device(account, vault_id)
    await account.post(f"/vaults/{vault_id}/devices/{device_id}/credentials", credential())
    first = await account.put(
        mirror_path(vault_id, device_id), device_key_envelope(vault_id, device_id)
    )
    second = await account.put(
        mirror_path(vault_id, device_id), device_key_envelope(vault_id, device_id)
    )
    assert first.status_code == second.status_code == 200
    assert first.json()["nonce"] != second.json()["nonce"]
    assert (await account.get(mirror_path(vault_id, device_id))).json() == second.json()


async def test_only_prf_credentials_may_mirror(account: Api, vault_id: str) -> None:
    device_id = await add_device(account, vault_id)
    for mechanism in ("large_blob", "uv_gated_local"):
        await account.post(
            f"/vaults/{vault_id}/devices/{device_id}/credentials", credential(mechanism)
        )
        response = await account.put(
            mirror_path(vault_id, device_id), device_key_envelope(vault_id, device_id)
        )
        assert response.status_code == 422, mechanism
        assert "prf" in response.json()["detail"]


async def test_mirror_must_match_vault_device_and_credential(account: Api, vault_id: str) -> None:
    device_id = await add_device(account, vault_id)
    await account.post(f"/vaults/{vault_id}/devices/{device_id}/credentials", credential())

    wrong_vault = await account.put(
        mirror_path(vault_id, device_id), device_key_envelope("vault_other", device_id)
    )
    assert wrong_vault.status_code == 422

    wrong_device = await account.put(
        mirror_path(vault_id, device_id), device_key_envelope(vault_id, "dev_other")
    )
    assert wrong_device.status_code == 422

    other_credential = base64.b64encode(secrets.token_bytes(16)).decode()
    wrong_credential = await account.put(
        mirror_path(vault_id, device_id),
        device_key_envelope(vault_id, device_id, credentialId=other_credential),
    )
    assert wrong_credential.status_code == 422


async def test_mirror_rejects_malformed_blobs(account: Api, vault_id: str) -> None:
    device_id = await add_device(account, vault_id)
    await account.post(f"/vaults/{vault_id}/devices/{device_id}/credentials", credential())
    for bad in (
        device_key_envelope(vault_id, device_id, nonce=b64(11)),
        device_key_envelope(vault_id, device_id, ciphertext=b64(31)),
        device_key_envelope(vault_id, device_id, tag=b64(17)),
        device_key_envelope(vault_id, device_id, version=2),
    ):
        response = await account.put(mirror_path(vault_id, device_id), bad)
        assert response.status_code == 422, bad


async def test_missing_mirror_is_404(account: Api, vault_id: str) -> None:
    device_id = await add_device(account, vault_id)
    await account.post(f"/vaults/{vault_id}/devices/{device_id}/credentials", credential())
    assert (await account.get(mirror_path(vault_id, device_id))).status_code == 404


async def test_credential_cannot_be_claimed_by_two_devices(account: Api, vault_id: str) -> None:
    first = await add_device(account, vault_id, "dev_one")
    second = await add_device(account, vault_id, "dev_two")
    assert (
        await account.post(f"/vaults/{vault_id}/devices/{first}/credentials", credential())
    ).status_code == 201
    clash = await account.post(f"/vaults/{vault_id}/devices/{second}/credentials", credential())
    assert clash.status_code == 409


async def test_has_device_envelope_follows_the_active_snapshot(account: Api, vault_id: str) -> None:
    device_id = await add_device(account, vault_id)
    await account.post(
        f"/vaults/{vault_id}/snapshots",
        snapshot(envelopes=[master_envelope(), device_envelope(device_id)]),
    )
    devices = (await account.get(f"/vaults/{vault_id}/devices")).json()
    assert devices[0]["hasDeviceEnvelope"] is True

    # Soft revocation: commit a snapshot without that device's envelope.
    await account.post(
        f"/vaults/{vault_id}/snapshots",
        snapshot(revision=2, expected_revision=1, envelopes=[master_envelope()]),
    )
    devices = (await account.get(f"/vaults/{vault_id}/devices")).json()
    assert devices[0]["hasDeviceEnvelope"] is False


async def test_revoked_device_cannot_receive_a_new_envelope(account: Api, vault_id: str) -> None:
    device_id = await add_device(account, vault_id)
    revoked = await account.delete(f"/vaults/{vault_id}/devices/{device_id}")
    assert revoked.status_code == 200
    assert revoked.json()["revokedAt"] is not None
    assert revoked.json()["credentials"] == []

    response = await account.post(
        f"/vaults/{vault_id}/snapshots",
        snapshot(envelopes=[master_envelope(), device_envelope(device_id)]),
    )
    assert response.status_code == 422
    assert "revoked" in response.json()["detail"]


async def test_revoking_a_device_revokes_its_credentials(account: Api, vault_id: str) -> None:
    device_id = await add_device(account, vault_id)
    await account.post(f"/vaults/{vault_id}/devices/{device_id}/credentials", credential())
    revoked = (await account.delete(f"/vaults/{vault_id}/devices/{device_id}")).json()
    assert revoked["credentials"][0]["revokedAt"] is not None
    assert (
        await account.post(f"/vaults/{vault_id}/devices/{device_id}/credentials", credential())
    ).status_code == 409


async def test_devices_are_scoped_to_the_owning_account(
    anonymous: Api, account: Api, vault_id: str
) -> None:
    await add_device(account, vault_id)
    await anonymous.register("other@example.com")
    assert (await anonymous.get(f"/vaults/{vault_id}/devices")).status_code == 404
    assert (
        await anonymous.post(f"/vaults/{vault_id}/devices", {"deviceId": "dev_x", "label": "x"})
    ).status_code == 404
