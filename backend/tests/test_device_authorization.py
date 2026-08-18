"""Device routes: authenticated → owns vault → device belongs to vault.

Device registration is not part of this milestone, so the rows are created
directly through the session. What is under test is the authorization chain in
front of them and the shape of what comes back.
"""

from __future__ import annotations

import os
import uuid

import pytest

from app.models.device import Device
from app.models.device_key_envelope import DeviceKeyEnvelope
from app.models.webauthn_credential import WebAuthnCredential
from tests.helpers import create_vault, register_and_login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _add_device(
    db_session, vault_id: str, *, device_id: str = "laptop-chrome-profile-1"
) -> Device:
    device = Device(
        vault_id=uuid.UUID(vault_id), device_id=device_id, display_name="Work laptop"
    )
    db_session.add(device)
    await db_session.commit()
    await db_session.refresh(device)
    return device


async def _add_credential_and_envelope(db_session, vault_id: str, device: Device) -> None:
    credential_id = os.urandom(32)
    credential = WebAuthnCredential(
        device_id=device.id,
        rp_id="pass.example.local",
        credential_id=credential_id,
        public_key=b"\x00" * 64,
        prf_supported=True,
    )
    db_session.add(credential)
    await db_session.flush()

    db_session.add(
        DeviceKeyEnvelope(
            vault_id=uuid.UUID(vault_id),
            device_id=device.id,
            webauthn_credential_id=credential.id,
            credential_id=credential_id,
            nonce=b"\x00" * 12,
            ciphertext=b"\x33" * 32,
            tag=b"\x44" * 16,
            crypto_version=1,
        )
    )
    await db_session.commit()


async def test_listing_devices_requires_authentication(client, anonymous_client, db_session):
    await register_and_login(client)
    vault_id = await create_vault(client)
    await _add_device(db_session, vault_id)

    response = await anonymous_client.get(f"/vaults/{vault_id}/devices")
    assert response.status_code == 401


async def test_reading_a_device_requires_authentication(client, anonymous_client, db_session):
    await register_and_login(client)
    vault_id = await create_vault(client)
    device = await _add_device(db_session, vault_id)

    response = await anonymous_client.get(f"/vaults/{vault_id}/devices/{device.id}")
    assert response.status_code == 401


async def test_owner_can_list_their_devices(client, db_session):
    await register_and_login(client)
    vault_id = await create_vault(client)
    device = await _add_device(db_session, vault_id)

    response = await client.get(f"/vaults/{vault_id}/devices")

    assert response.status_code == 200
    listed = response.json()
    assert [entry["id"] for entry in listed] == [str(device.id)]
    assert listed[0]["device_id"] == device.device_id


async def test_owner_can_read_one_device(client, db_session):
    await register_and_login(client)
    vault_id = await create_vault(client)
    device = await _add_device(db_session, vault_id)

    response = await client.get(f"/vaults/{vault_id}/devices/{device.id}")

    assert response.status_code == 200
    assert response.json()["id"] == str(device.id)


async def test_another_user_cannot_list_devices_of_a_vault_they_do_not_own(
    client, other_client, db_session
):
    await register_and_login(client)
    victim_vault = await create_vault(client)
    await _add_device(db_session, victim_vault)

    await register_and_login(other_client)

    response = await other_client.get(f"/vaults/{victim_vault}/devices")
    assert response.status_code == 404


async def test_another_user_cannot_read_a_device_of_a_vault_they_do_not_own(
    client, other_client, db_session
):
    await register_and_login(client)
    victim_vault = await create_vault(client)
    device = await _add_device(db_session, victim_vault)

    await register_and_login(other_client)

    response = await other_client.get(f"/vaults/{victim_vault}/devices/{device.id}")
    # The vault check fails first, so the attacker learns nothing about the
    # device id either.
    assert response.status_code == 404
    assert response.json()["detail"] == "vault not found"


async def test_a_device_id_cannot_be_used_across_vaults(client, other_client, db_session):
    """A real device id, presented under a vault the caller *does* own."""
    await register_and_login(client)
    victim_vault = await create_vault(client)
    victim_device = await _add_device(db_session, victim_vault)

    await register_and_login(other_client)
    attacker_vault = await create_vault(other_client)

    response = await other_client.get(f"/vaults/{attacker_vault}/devices/{victim_device.id}")

    assert response.status_code == 404
    assert response.json()["detail"] == "device not found"


async def test_a_device_of_another_vault_is_not_listed_under_this_one(
    client, other_client, db_session
):
    await register_and_login(client)
    victim_vault = await create_vault(client)
    victim_device = await _add_device(db_session, victim_vault)

    await register_and_login(other_client)
    attacker_vault = await create_vault(other_client)
    await _add_device(db_session, attacker_vault, device_id="attacker-device")

    listed = (await other_client.get(f"/vaults/{attacker_vault}/devices")).json()

    assert str(victim_device.id) not in {entry["id"] for entry in listed}


async def test_device_responses_never_carry_key_material(client, db_session):
    """DK, DWK, VK, PRF output and the credential's own bytes stay out of the response.

    The first four the server has never held (webauthn-prf.md §1). The last two
    — the COSE public key and the raw credential id — it does hold, and
    `DeviceOut` simply does not name them.
    """
    await register_and_login(client)
    vault_id = await create_vault(client)
    device = await _add_device(db_session, vault_id)
    await _add_credential_and_envelope(db_session, vault_id, device)

    listed = (await client.get(f"/vaults/{vault_id}/devices")).json()
    single = (await client.get(f"/vaults/{vault_id}/devices/{device.id}")).json()

    assert single["has_device_key_envelope"] is True
    for payload in (listed[0], single):
        assert set(payload) == {
            "id",
            "device_id",
            "display_name",
            "last_seen_at",
            "revoked_at",
            "webauthn_credentials",
            "has_device_key_envelope",
        }
        for credential in payload["webauthn_credentials"]:
            assert set(credential) == {
                "id",
                "rp_id",
                "prf_supported",
                "large_blob_supported",
                "user_verification",
                "last_used_at",
                "revoked_at",
            }

    # And nothing that looks like an envelope's bytes made it into the wire form.
    for banned in ("ciphertext", "nonce", "tag", "public_key", "credential_id"):
        assert banned not in (await client.get(f"/vaults/{vault_id}/devices")).text
