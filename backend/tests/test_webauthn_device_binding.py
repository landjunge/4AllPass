"""Explicit device selectors bind real synthetic COSE assertions, not team admission."""
from __future__ import annotations

import base64

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.webauthn_credential import WebAuthnCredential
from tests.test_webauthn_cose import DEVICE_A, _auth, _b64, _signup, _vault_and_device
from tests.webauthn_cose_fixtures import RP_ID, SoftwarePasskey

pytestmark = pytest.mark.asyncio(loop_scope="session")
DEVICE_B = "dev_binding_bbbbbbbbbbbbbbbb"


async def _issue(client, token, vault, purpose, device):
    response = await client.post(
        f"/api/v1/vaults/{vault}/webauthn/challenges", headers=_auth(token),
        json={"purpose": purpose, "deviceId": device},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _setup(client):
    token = await _signup(client)
    vault = await _vault_and_device(client, token)
    response = await client.post(
        f"/api/v1/vaults/{vault}/devices", headers=_auth(token),
        json={"deviceId": DEVICE_B, "label": "Synthetic second device"},
    )
    assert response.status_code == 200
    keys = {}
    for device in (DEVICE_A, DEVICE_B):
        key = SoftwarePasskey()
        issued = await _issue(client, token, vault, "create", device)
        blob = key.registration(base64.b64decode(issued["challenge"]))
        response = await client.post(
            f"/api/v1/vaults/{vault}/devices/{device}/credentials", headers=_auth(token),
            json={
                "credentialId": _b64(blob["credential_id"]), "rpId": RP_ID,
                "mechanism": "prf", "prfSupported": True, "largeBlobSupported": False,
                "challengeId": issued["challengeId"], "challenge": issued["challenge"],
                "clientDataJSON": _b64(blob["client_data_json"]),
                "attestationObject": _b64(blob["attestation_object"]),
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["verification"] == "cose_verified"
        keys[device] = key
    return token, vault, keys


async def _consume(client, token, vault, issued, device, key=None):
    payload = {"purpose": "assert", "challenge": issued["challenge"], "deviceId": device}
    if key is not None:
        signed = key.assertion(base64.b64decode(issued["challenge"]))
        payload.update({
            "credentialId": _b64(signed["credential_id"]),
            "clientDataJSON": _b64(signed["client_data_json"]),
            "authenticatorData": _b64(signed["authenticator_data"]),
            "signature": _b64(signed["signature"]),
        })
    return await client.post(
        f"/api/v1/vaults/{vault}/webauthn/challenges/{issued['challengeId']}/consume",
        headers=_auth(token), json=payload,
    )


async def _stamp(engine, key):
    async with async_sessionmaker(engine)() as db:
        row = (await db.execute(select(WebAuthnCredential).where(
            WebAuthnCredential.credential_id == key.credential_id,
        ))).scalar_one()
        return row.sign_count, row.last_used_at is not None


@pytest.mark.parametrize("issued_device,claimed_device", [(DEVICE_A, DEVICE_A), (None, DEVICE_A)])
async def test_other_device_assertion_is_not_found_without_usage_stamp(client, engine, issued_device, claimed_device):
    token, vault, keys = await _setup(client)
    issued = await _issue(client, token, vault, "assert", issued_device)
    response = await _consume(client, token, vault, issued, claimed_device, keys[DEVICE_B])
    assert response.status_code == 404, response.text
    assert await _stamp(engine, keys[DEVICE_B]) == (0, False)
    # The failed attempt consumed its one-time challenge, even with the right key later.
    response = await _consume(client, token, vault, issued, claimed_device, keys[DEVICE_A])
    assert response.status_code == 404


async def test_matching_device_assertion_updates_usage_and_cannot_replay(client, engine):
    token, vault, keys = await _setup(client)
    issued = await _issue(client, token, vault, "assert", DEVICE_A)
    assert (await _consume(client, token, vault, issued, DEVICE_A, keys[DEVICE_A])).status_code == 204
    assert await _stamp(engine, keys[DEVICE_A]) == (1, True)
    assert await _stamp(engine, keys[DEVICE_B]) == (0, False)
    assert (await _consume(client, token, vault, issued, DEVICE_A, keys[DEVICE_A])).status_code == 404


@pytest.mark.parametrize("claimed_device", [None, DEVICE_B])
async def test_bound_challenge_refuses_changed_or_missing_consume_selector(client, engine, claimed_device):
    token, vault, keys = await _setup(client)
    issued = await _issue(client, token, vault, "assert", DEVICE_A)
    assert (await _consume(client, token, vault, issued, claimed_device, keys[DEVICE_B])).status_code == 404
    assert await _stamp(engine, keys[DEVICE_B]) == (0, False)


async def test_unbound_legacy_assertion_remains_supported_but_has_no_admission_result(client, engine):
    token, vault, keys = await _setup(client)
    issued = await _issue(client, token, vault, "assert", None)
    response = await _consume(client, token, vault, issued, None, keys[DEVICE_B])
    assert response.status_code == 204 and not response.content
    assert await _stamp(engine, keys[DEVICE_B]) == (1, True)


async def test_unsigned_consume_is_only_challenge_hygiene_without_usage_or_admission(client, engine):
    token, vault, keys = await _setup(client)
    issued = await _issue(client, token, vault, "assert", DEVICE_A)
    response = await _consume(client, token, vault, issued, DEVICE_A)
    assert response.status_code == 204 and not response.content
    assert await _stamp(engine, keys[DEVICE_A]) == (0, False)
    assert await _stamp(engine, keys[DEVICE_B]) == (0, False)
