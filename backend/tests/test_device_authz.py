"""Authorization on the device routes — Security Boundary v1.

The routes existed before this boundary and were deliberately open. These tests
pin the two rules that now apply: the caller must be authenticated, and the
caller must own the vault named in the path. They also pin what a response may
contain, because "authorized" must not start meaning "gets key material".
"""

import base64
import uuid

import pytest
from sqlalchemy import select

from app.models.device import Device
from app.models.device_key_envelope import DeviceKeyEnvelope
from app.models.user import User
from app.models.vault import Vault
from app.models.webauthn_credential import WebAuthnCredential
from tests.test_auth import PASSWORD, register_and_login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _account_with_vault(api_client, db_session, *, return_envelope_bytes: bool = False):
    """A logged-in account owning a vault with one device on file.

    Returns `(tokens, vault, device)`, plus the raw Device-Key Envelope bytes
    when the caller needs to assert they never leave the database.
    """
    email, tokens = await register_and_login(api_client)
    user = (await db_session.execute(select(User).where(User.email == email))).scalar_one()

    vault = Vault(owner_user_id=user.id, crypto_protocol_version=1)
    db_session.add(vault)
    await db_session.flush()

    device = Device(
        vault_id=vault.id,
        device_id="dev_laptop_chrome_profile_1",
        display_name="Laptop (Chrome)",
    )
    db_session.add(device)
    await db_session.flush()

    envelope_bytes = {
        "nonce": bytes(range(12)),
        "ciphertext": bytes((i * 7 + 3) % 256 for i in range(32)),
        "tag": bytes((i * 11 + 5) % 256 for i in range(16)),
    }
    credential_id = uuid.uuid4().bytes
    credential = WebAuthnCredential(
        device_id=device.id,
        rp_id="pass.example.test",
        credential_id=credential_id,
        public_key=b"\x30" * 32,
        prf_supported=True,
    )
    db_session.add(credential)
    await db_session.flush()

    # An opaque mirror of the Device-Key Envelope: the server stores these bytes
    # but can never derive the DWK needed to open them (webauthn-prf.md §4).
    db_session.add(
        DeviceKeyEnvelope(
            vault_id=vault.id,
            device_id=device.id,
            webauthn_credential_id=credential.id,
            credential_id=credential_id,
            **envelope_bytes,
        )
    )
    await db_session.commit()
    if return_envelope_bytes:
        return tokens, vault, device, envelope_bytes
    return tokens, vault, device


def _auth(tokens: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


class TestUnauthenticated:
    async def test_list_requires_a_token(self, api_client, db_session):
        _, vault, _ = await _account_with_vault(api_client, db_session)
        response = await api_client.get(f"/vaults/{vault.id}/devices")
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"

    async def test_detail_requires_a_token(self, api_client, db_session):
        _, vault, device = await _account_with_vault(api_client, db_session)
        response = await api_client.get(f"/vaults/{vault.id}/devices/{device.id}")
        assert response.status_code == 401

    async def test_an_expired_or_revoked_token_is_not_enough(self, api_client, db_session):
        tokens, vault, _ = await _account_with_vault(api_client, db_session)
        await api_client.post(
            "/auth/logout", json={"refresh_token": tokens["refresh_token"]}, headers=_auth(tokens)
        )
        response = await api_client.get(f"/vaults/{vault.id}/devices", headers=_auth(tokens))
        assert response.status_code == 401


class TestOwnership:
    async def test_owner_sees_their_devices(self, api_client, db_session):
        tokens, vault, device = await _account_with_vault(api_client, db_session)

        response = await api_client.get(f"/vaults/{vault.id}/devices", headers=_auth(tokens))
        assert response.status_code == 200
        body = response.json()
        assert [entry["device_id"] for entry in body] == ["dev_laptop_chrome_profile_1"]
        assert body[0]["has_device_key_envelope"] is True

        detail = await api_client.get(
            f"/vaults/{vault.id}/devices/{device.id}", headers=_auth(tokens)
        )
        assert detail.status_code == 200
        assert detail.json()["id"] == str(device.id)

    async def test_another_account_cannot_read_the_vault(self, api_client, db_session):
        _, vault, device = await _account_with_vault(api_client, db_session)
        _, intruder = await register_and_login(api_client)

        listing = await api_client.get(f"/vaults/{vault.id}/devices", headers=_auth(intruder))
        detail = await api_client.get(
            f"/vaults/{vault.id}/devices/{device.id}", headers=_auth(intruder)
        )

        # 404, not 403: confirming the id exists would be an oracle over other
        # accounts' vaults.
        assert listing.status_code == 404
        assert detail.status_code == 404
        assert listing.json()["detail"] == "vault not found"

    async def test_an_unknown_vault_looks_the_same_as_someone_elses(self, api_client, db_session):
        _, vault, _ = await _account_with_vault(api_client, db_session)
        _, intruder = await register_and_login(api_client)

        someone_elses = await api_client.get(f"/vaults/{vault.id}/devices", headers=_auth(intruder))
        never_existed = await api_client.get(
            f"/vaults/{uuid.uuid4()}/devices", headers=_auth(intruder)
        )
        assert someone_elses.status_code == never_existed.status_code == 404
        assert someone_elses.json() == never_existed.json()

    async def test_a_device_of_another_vault_is_not_reachable_through_an_owned_vault(
        self, api_client, db_session
    ):
        """The device id must be scoped by the vault, not looked up globally."""
        _, other_vault, other_device = await _account_with_vault(api_client, db_session)
        own_tokens, own_vault, _ = await _account_with_vault(api_client, db_session)

        response = await api_client.get(
            f"/vaults/{own_vault.id}/devices/{other_device.id}", headers=_auth(own_tokens)
        )
        assert response.status_code == 404
        assert other_vault.id != own_vault.id

    async def test_a_token_does_not_carry_vault_access_after_ownership_changes(
        self, api_client, db_session
    ):
        """Authorization is re-checked per request, never cached in the token."""
        tokens, vault, _ = await _account_with_vault(api_client, db_session)
        assert (
            await api_client.get(f"/vaults/{vault.id}/devices", headers=_auth(tokens))
        ).status_code == 200

        stranger = User(email=f"new-owner-{uuid.uuid4().hex[:8]}@example.test")
        db_session.add(stranger)
        await db_session.flush()
        vault.owner_user_id = stranger.id
        await db_session.commit()

        # Same token, same vault id — but the account no longer owns it.
        assert (
            await api_client.get(f"/vaults/{vault.id}/devices", headers=_auth(tokens))
        ).status_code == 404

    async def test_deactivating_the_account_closes_the_boundary(self, api_client, db_session):
        tokens, vault, _ = await _account_with_vault(api_client, db_session)
        user = (
            await db_session.execute(
                select(User).where(User.id == select(Vault.owner_user_id).where(Vault.id == vault.id).scalar_subquery())
            )
        ).scalar_one()
        user.is_active = False
        await db_session.commit()

        response = await api_client.get(f"/vaults/{vault.id}/devices", headers=_auth(tokens))
        assert response.status_code == 401


class TestResponseContents:
    EXPECTED_DEVICE_FIELDS = {
        "id",
        "device_id",
        "display_name",
        "last_seen_at",
        "revoked_at",
        "webauthn_credentials",
        "has_device_key_envelope",
    }
    EXPECTED_CREDENTIAL_FIELDS = {
        "id",
        "rp_id",
        "prf_supported",
        "large_blob_supported",
        "user_verification",
        "last_used_at",
        "revoked_at",
    }

    async def test_responses_expose_metadata_fields_only(self, api_client, db_session):
        tokens, vault, device = await _account_with_vault(api_client, db_session)

        listing = await api_client.get(f"/vaults/{vault.id}/devices", headers=_auth(tokens))
        detail = await api_client.get(
            f"/vaults/{vault.id}/devices/{device.id}", headers=_auth(tokens)
        )
        assert listing.status_code == detail.status_code == 200

        for payload in [*listing.json(), detail.json()]:
            assert set(payload) == self.EXPECTED_DEVICE_FIELDS
            # The envelope is a boolean fact ("one is on file"), not bytes.
            assert isinstance(payload["has_device_key_envelope"], bool)
            for credential in payload["webauthn_credentials"]:
                assert set(credential) == self.EXPECTED_CREDENTIAL_FIELDS
                # Not even the public key or the raw credential id are handed out
                # here: both are inputs to the client's AAD and DWK derivation.
                assert "public_key" not in credential
                assert "credential_id" not in credential

    async def test_responses_contain_no_stored_key_bytes(self, api_client, db_session):
        """The stored envelope bytes must not appear in any encoding."""
        tokens, vault, device, envelope_bytes = await _account_with_vault(
            api_client, db_session, return_envelope_bytes=True
        )

        listing = await api_client.get(f"/vaults/{vault.id}/devices", headers=_auth(tokens))
        detail = await api_client.get(
            f"/vaults/{vault.id}/devices/{device.id}", headers=_auth(tokens)
        )

        for response in (listing, detail):
            body = response.text
            for label, raw in envelope_bytes.items():
                for encoded in (
                    raw.hex(),
                    base64.b64encode(raw).decode(),
                    base64.urlsafe_b64encode(raw).decode().rstrip("="),
                    raw.decode("latin-1"),
                ):
                    assert encoded not in body, f"{label} leaked into the response"

    async def test_password_hash_never_appears_in_an_auth_response(self, api_client):
        email, tokens = await register_and_login(api_client)
        me = await api_client.get("/auth/me", headers=_auth(tokens))
        assert me.status_code == 200
        assert set(me.json()) == {"id", "email"}
        assert PASSWORD not in me.text
        assert "argon2" not in me.text.lower()
