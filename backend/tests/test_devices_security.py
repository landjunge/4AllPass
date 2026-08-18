import pytest

from tests.helpers import auth, commit_revision, create_vault, device_envelope, master_envelope, register_device, signup

pytestmark = pytest.mark.asyncio(loop_scope="session")

def _b64(seed: int) -> str:
    return __import__("base64").b64encode(bytes([seed]) * 32).decode("ascii")


def _path(seed: int) -> str:
    return _b64(seed).rstrip("=")


def _envelope_body(vault_id: str, device_id: str, credential_id: str) -> dict:
    return {
        "version": 1,
        "vaultId": vault_id,
        "deviceId": device_id,
        "credentialId": credential_id,
        "deviceKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        "tag": "AgICAgICAgICAgICAgICAg==",
    }


async def _provision(client, device: str | None = None, cred_seed: int = 1):
    device = device or f"dev_{__import__('uuid').uuid4().hex[:24]}"
    cred_b64 = _b64(cred_seed)
    cred_path = cred_b64.rstrip("=")
    _, token = await signup(client)
    vault_id = await create_vault(client, token)
    assert (await register_device(client, token, vault_id, device)).status_code == 200
    cred = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{device}/credentials",
        headers=auth(token),
        json={
            "credentialId": cred_b64,
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert cred.status_code == 200, cred.text
    return token, vault_id, device, cred_b64, cred_path, cred.json()


async def test_credential_claims_are_not_server_verified(client):
    token, vault_id, _device, _b, _p, cred = await _provision(client, cred_seed=11)
    assert cred["prfSupported"] is True
    assert cred["webauthnPossessionVerified"] is False
    assert cred["prfVerifiedByServer"] is False
    listed = await client.get(f"/api/v1/vaults/{vault_id}/devices", headers=auth(token))
    assert listed.json()[0]["credentials"][0]["webauthnPossessionVerified"] is False


async def test_envelope_requires_matching_device_and_credential(client):
    token, vault_id, device, cred_b64, cred_path, _ = await _provision(client, cred_seed=21)
    other = "dev_other_001122334455667788"
    assert (await register_device(client, token, vault_id, other)).status_code == 200
    await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{other}/credentials",
        headers=auth(token),
        json={
            "credentialId": _b64(22),
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )

    cross_device = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{other}/credentials/{cred_path}/device-key-envelope",
        headers=auth(token),
        json=_envelope_body(vault_id, device, cred_b64),
    )
    assert cross_device.status_code in {404, 422}

    wrong_identity = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device}/credentials/{cred_path}/device-key-envelope",
        headers=auth(token),
        json=_envelope_body(vault_id, other, cred_b64),
    )
    assert wrong_identity.status_code == 422

    ok = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device}/credentials/{cred_path}/device-key-envelope",
        headers=auth(token),
        json=_envelope_body(vault_id, device, cred_b64),
    )
    assert ok.status_code == 200, ok.text
    fetched = await client.get(
        f"/api/v1/vaults/{vault_id}/devices/{device}/credentials/{cred_path}/device-key-envelope",
        headers=auth(token),
    )
    assert fetched.status_code == 200
    assert fetched.json()["ciphertext"] == ok.json()["ciphertext"]
    assert fetched.json()["deviceId"] == device
    assert fetched.json()["vaultId"] == vault_id


async def test_revocation_is_metadata_only_and_does_not_claim_crypto_erase(client):
    token, vault_id, device, cred_b64, cred_path, _ = await _provision(client, cred_seed=31)
    await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device}/credentials/{cred_path}/device-key-envelope",
        headers=auth(token),
        json=_envelope_body(vault_id, device, cred_b64),
    )
    snap = await commit_revision(
        client,
        token,
        vault_id,
        revision=1,
        expected=0,
        envelopes=[master_envelope(), device_envelope(device)],
    )
    assert snap.status_code == 200

    revoked = await client.delete(f"/api/v1/vaults/{vault_id}/devices/{device}", headers=auth(token))
    assert revoked.status_code == 200, revoked.text
    body = revoked.json()
    assert body["revokedAt"] is not None
    assert body["revocationKind"] == "metadata_only"
    # The active snapshot still has the device envelope — DELETE did not
    # cryptographically erase the device.
    assert body["hasDeviceEnvelope"] is True

    envelope = await client.get(
        f"/api/v1/vaults/{vault_id}/devices/{device}/credentials/{cred_path}/device-key-envelope",
        headers=auth(token),
    )
    assert envelope.status_code == 409

    put = await client.put(
        f"/api/v1/vaults/{vault_id}/devices/{device}/credentials/{cred_path}/device-key-envelope",
        headers=auth(token),
        json=_envelope_body(vault_id, device, cred_b64),
    )
    assert put.status_code == 409

    cred = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{device}/credentials",
        headers=auth(token),
        json={
            "credentialId": _b64(32),
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert cred.status_code == 409

    silent = await register_device(client, token, vault_id, device)
    assert silent.status_code == 409

    reactivated = await register_device(client, token, vault_id, device, reactivate=True)
    assert reactivated.status_code == 200
    assert reactivated.json()["revokedAt"] is None
    assert reactivated.json()["revocationKind"] == "none"
    # Re-activating metadata still leaves the previous snapshot envelope in place
    # until the client commits a new revision.
    assert reactivated.json()["hasDeviceEnvelope"] is True


async def test_soft_revoke_is_absence_of_device_envelope_in_next_snapshot(client):
    token, vault_id, device, _b, _p, _c = await _provision(client, cred_seed=41)
    first = await commit_revision(
        client,
        token,
        vault_id,
        revision=1,
        expected=0,
        envelopes=[master_envelope(), device_envelope(device)],
    )
    assert first.status_code == 200
    listed = await client.get(f"/api/v1/vaults/{vault_id}/devices", headers=auth(token))
    assert listed.json()[0]["hasDeviceEnvelope"] is True

    second = await commit_revision(
        client,
        token,
        vault_id,
        revision=2,
        expected=1,
        envelopes=[master_envelope()],
    )
    assert second.status_code == 200
    listed = await client.get(f"/api/v1/vaults/{vault_id}/devices", headers=auth(token))
    assert listed.json()[0]["hasDeviceEnvelope"] is False
    types = [env["type"] for env in second.json()["envelopes"]]
    assert types == ["master"]
