"""COSE ceremony verification — not PRF, not vault unwrap."""

from __future__ import annotations

import base64
import uuid

import pytest

from app.core.config import get_settings
from app.core.webauthn_cose import CeremonyError, verify_assertion, verify_attestation
from tests.webauthn_cose_fixtures import RP_ID, SoftwarePasskey

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASSWORD = "account-password-1234"
DEVICE_A = "dev_cose_aaaaaaaaaaaaaaaaaa"


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _signup(client) -> str:
    email = f"cose-{uuid.uuid4().hex[:10]}@example.com"
    response = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return response.json()["token"]


async def _vault_and_device(client, token: str) -> str:
    created = await client.post("/api/v1/vaults", headers=_auth(token))
    assert created.status_code == 201
    vault_id = created.json()["vaultId"]
    registered = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(token),
        json={"deviceId": DEVICE_A, "label": "COSE test"},
    )
    assert registered.status_code == 200, registered.text
    return vault_id


async def _issue(client, token: str, vault_id: str, purpose: str) -> dict:
    issued = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges",
        headers=_auth(token),
        json={"purpose": purpose, "deviceId": DEVICE_A},
    )
    assert issued.status_code == 200, issued.text
    return issued.json()


async def test_software_passkey_verifies_locally():
    key = SoftwarePasskey()
    challenge = b"\x11" * 32
    registration = key.registration(challenge)
    verified = verify_attestation(
        credential_id=registration["credential_id"],
        client_data_json=registration["client_data_json"],
        attestation_object=registration["attestation_object"],
        expected_challenge=challenge,
        expected_rp_id=RP_ID,
        settings=get_settings(),
    )
    assert verified.credential_id == key.credential_id
    assert verified.public_key

    assertion = key.assertion(challenge)
    checked = verify_assertion(
        credential_id=assertion["credential_id"],
        client_data_json=assertion["client_data_json"],
        authenticator_data=assertion["authenticator_data"],
        signature=assertion["signature"],
        public_key=verified.public_key,
        current_sign_count=0,
        expected_challenge=challenge,
        expected_rp_id=RP_ID,
        settings=get_settings(),
    )
    assert checked.sign_count == 1

    with pytest.raises(CeremonyError):
        verify_attestation(
            credential_id=registration["credential_id"],
            client_data_json=registration["client_data_json"],
            attestation_object=registration["attestation_object"],
            expected_challenge=b"\x22" * 32,
            expected_rp_id=RP_ID,
            settings=get_settings(),
        )


async def test_register_with_attestation_is_cose_verified(client):
    token = await _signup(client)
    vault_id = await _vault_and_device(client, token)
    issued = await _issue(client, token, vault_id, "create")
    challenge = base64.b64decode(issued["challenge"])
    key = SoftwarePasskey()
    blob = key.registration(challenge)
    posted = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=_auth(token),
        json={
            "credentialId": _b64(blob["credential_id"]),
            "rpId": RP_ID,
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
            "challengeId": issued["challengeId"],
            "challenge": issued["challenge"],
            "clientDataJSON": _b64(blob["client_data_json"]),
            "attestationObject": _b64(blob["attestation_object"]),
        },
    )
    assert posted.status_code == 200, posted.text
    body = posted.json()
    assert body["verification"] == "cose_verified"
    assert body["serverVerified"] is True
    assert "prf" not in body["verification"]

    reused = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges/{issued['challengeId']}/consume",
        headers=_auth(token),
        json={"purpose": "create", "challenge": issued["challenge"]},
    )
    assert reused.status_code == 404


async def test_register_rejects_wrong_origin_and_keeps_client_asserted_without_attestation(client):
    token = await _signup(client)
    vault_id = await _vault_and_device(client, token)
    issued = await _issue(client, token, vault_id, "create")
    challenge = base64.b64decode(issued["challenge"])
    key = SoftwarePasskey()
    blob = key.registration(challenge, origin="https://evil.example")
    bad = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=_auth(token),
        json={
            "credentialId": _b64(blob["credential_id"]),
            "rpId": RP_ID,
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
            "challengeId": issued["challengeId"],
            "challenge": issued["challenge"],
            "clientDataJSON": _b64(blob["client_data_json"]),
            "attestationObject": _b64(blob["attestation_object"]),
        },
    )
    assert bad.status_code == 422, bad.text

    legacy = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=_auth(token),
        json={
            "credentialId": _b64(b"legacy-credential-id-16"),
            "rpId": RP_ID,
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["verification"] == "client_asserted"
    assert legacy.json()["serverVerified"] is False


async def test_consume_verifies_assertion_and_rejects_replay_signature(client):
    token = await _signup(client)
    vault_id = await _vault_and_device(client, token)
    create = await _issue(client, token, vault_id, "create")
    key = SoftwarePasskey()
    blob = key.registration(base64.b64decode(create["challenge"]))
    posted = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=_auth(token),
        json={
            "credentialId": _b64(blob["credential_id"]),
            "rpId": RP_ID,
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
            "challengeId": create["challengeId"],
            "challenge": create["challenge"],
            "clientDataJSON": _b64(blob["client_data_json"]),
            "attestationObject": _b64(blob["attestation_object"]),
        },
    )
    assert posted.status_code == 200, posted.text

    issued = await _issue(client, token, vault_id, "assert")
    assertion = key.assertion(base64.b64decode(issued["challenge"]))
    consumed = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges/{issued['challengeId']}/consume",
        headers=_auth(token),
        json={
            "purpose": "assert",
            "challenge": issued["challenge"],
            "credentialId": _b64(assertion["credential_id"]),
            "clientDataJSON": _b64(assertion["client_data_json"]),
            "authenticatorData": _b64(assertion["authenticator_data"]),
            "signature": _b64(assertion["signature"]),
        },
    )
    assert consumed.status_code == 204, consumed.text

    again = await _issue(client, token, vault_id, "assert")
    replay = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges/{again['challengeId']}/consume",
        headers=_auth(token),
        json={
            "purpose": "assert",
            "challenge": again["challenge"],
            "credentialId": _b64(assertion["credential_id"]),
            "clientDataJSON": _b64(assertion["client_data_json"]),
            "authenticatorData": _b64(assertion["authenticator_data"]),
            "signature": _b64(assertion["signature"]),
        },
    )
    assert replay.status_code == 422, replay.text


async def test_assert_after_hard_revoke_is_not_found(client):
    """Interaktions-Testplan 2.1: challenge issued, then hard-revoke, then delayed assertion.

    Ceremony consume is not vault unwrap. After metadata revoke the credential
    is 404 even if the challenge bytes are still in the client.
    """
    token = await _signup(client)
    vault_id = await _vault_and_device(client, token)
    create = await _issue(client, token, vault_id, "create")
    key = SoftwarePasskey()
    blob = key.registration(base64.b64decode(create["challenge"]))
    posted = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=_auth(token),
        json={
            "credentialId": _b64(blob["credential_id"]),
            "rpId": RP_ID,
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
            "challengeId": create["challengeId"],
            "challenge": create["challenge"],
            "clientDataJSON": _b64(blob["client_data_json"]),
            "attestationObject": _b64(blob["attestation_object"]),
        },
    )
    assert posted.status_code == 200, posted.text

    issued = await _issue(client, token, vault_id, "assert")
    assertion = key.assertion(base64.b64decode(issued["challenge"]))

    rotated = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=_auth(token),
        json={
            "revision": 1,
            "vaultKeyVersion": 2,
            "cryptoProtocolVersion": 1,
            "envelopes": [
                {
                    "version": 1,
                    "type": "master",
                    "vaultKeyVersion": 2,
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
            ],
            "entries": [],
        },
    )
    assert rotated.status_code == 200, rotated.text
    revoked = await client.delete(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}",
        headers=_auth(token),
    )
    assert revoked.status_code == 200
    assert revoked.json()["revocation"] == "metadata_only"

    consumed = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges/{issued['challengeId']}/consume",
        headers=_auth(token),
        json={
            "purpose": "assert",
            "challenge": issued["challenge"],
            "credentialId": _b64(assertion["credential_id"]),
            "clientDataJSON": _b64(assertion["client_data_json"]),
            "authenticatorData": _b64(assertion["authenticator_data"]),
            "signature": _b64(assertion["signature"]),
        },
    )
    assert consumed.status_code == 404, consumed.text
