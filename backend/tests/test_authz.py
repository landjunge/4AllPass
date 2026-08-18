"""Authorization / IDOR tests: vault ownership, device access chains,
forged identity fields, and response-shape audits.

Style follows docs/adversarial-review.md: each test is an attack that
must fail, not a feature that must work.
"""

import uuid

import pytest

from app.core.config import get_settings
from app.db.session import AsyncSessionLocal
from app.models.device import Device
from tests.conftest import make_api_client, register_and_login

pytestmark = pytest.mark.asyncio(loop_scope="session")

COOKIE = get_settings().session_cookie_name


async def _create_device(vault_id: str, device_id: str = "laptop-chrome-1") -> uuid.UUID:
    """Insert a device row directly (no device-registration endpoint yet)."""
    async with AsyncSessionLocal() as session:
        device = Device(vault_id=uuid.UUID(vault_id), device_id=device_id)
        session.add(device)
        await session.commit()
        return device.id


async def _create_vault(client) -> dict:
    response = await client.post("/vaults")
    assert response.status_code == 201, response.text
    return response.json()


async def test_unauthenticated_requests_rejected(api_client):
    some_id = uuid.uuid4()
    assert (await api_client.post("/vaults")).status_code == 401
    assert (await api_client.get("/vaults")).status_code == 401
    assert (await api_client.get(f"/vaults/{some_id}")).status_code == 401
    assert (await api_client.get(f"/vaults/{some_id}/devices")).status_code == 401
    assert (await api_client.get(f"/vaults/{some_id}/devices/{uuid.uuid4()}")).status_code == 401


async def test_owner_can_create_list_and_read_vault(engine):
    async with make_api_client() as client:
        await register_and_login(client)
        vault = await _create_vault(client)
        assert set(vault.keys()) == {
            "id",
            "crypto_protocol_version",
            "active_snapshot_id",
            "created_at",
        }
        assert vault["active_snapshot_id"] is None

        listing = await client.get("/vaults")
        assert listing.status_code == 200
        assert vault["id"] in [item["id"] for item in listing.json()]

        detail = await client.get(f"/vaults/{vault['id']}")
        assert detail.status_code == 200
        assert detail.json()["id"] == vault["id"]


async def test_cross_user_vault_access_denied_without_existence_leak(engine):
    async with make_api_client() as alice, make_api_client() as mallory:
        await register_and_login(alice)
        await register_and_login(mallory)
        vault = await _create_vault(alice)

        foreign = await mallory.get(f"/vaults/{vault['id']}")
        nonexistent = await mallory.get(f"/vaults/{uuid.uuid4()}")
        # Foreign vault and nonexistent vault are indistinguishable.
        assert foreign.status_code == 404
        assert nonexistent.status_code == 404
        assert foreign.json() == nonexistent.json()

        # Mallory's own listing must not contain Alice's vault.
        listing = await mallory.get("/vaults")
        assert vault["id"] not in [item["id"] for item in listing.json()]


async def test_cross_user_device_listing_denied(engine):
    async with make_api_client() as alice, make_api_client() as mallory:
        await register_and_login(alice)
        await register_and_login(mallory)
        vault = await _create_vault(alice)
        device_pk = await _create_device(vault["id"])

        assert (await alice.get(f"/vaults/{vault['id']}/devices")).status_code == 200
        assert (await mallory.get(f"/vaults/{vault['id']}/devices")).status_code == 404
        assert (
            await mallory.get(f"/vaults/{vault['id']}/devices/{device_pk}")
        ).status_code == 404


async def test_device_ids_cannot_be_used_across_vaults(engine):
    async with make_api_client() as alice, make_api_client() as mallory:
        await register_and_login(alice)
        await register_and_login(mallory)
        alice_vault = await _create_vault(alice)
        alice_device_pk = await _create_device(alice_vault["id"])
        mallory_vault = await _create_vault(mallory)

        # Mallory owns mallory_vault, but Alice's device must not resolve
        # through it — device lookup is scoped to the resolved vault.
        cross = await mallory.get(f"/vaults/{mallory_vault['id']}/devices/{alice_device_pk}")
        missing = await mallory.get(f"/vaults/{mallory_vault['id']}/devices/{uuid.uuid4()}")
        assert cross.status_code == 404
        assert missing.status_code == 404
        assert cross.json() == missing.json()


async def test_forged_owner_id_in_body_is_ignored(engine):
    async with make_api_client() as alice, make_api_client() as mallory:
        await register_and_login(alice)
        mallory_user = await register_and_login(mallory)

        # Alice tries to create a vault "for" Mallory / with forged fields.
        response = await alice.post(
            "/vaults",
            json={
                "owner_user_id": mallory_user["id"],
                "user_id": mallory_user["id"],
                "id": str(uuid.uuid4()),
            },
        )
        assert response.status_code == 201
        vault = response.json()

        # Ownership followed the session, not the body.
        assert (await alice.get(f"/vaults/{vault['id']}")).status_code == 200
        assert (await mallory.get(f"/vaults/{vault['id']}")).status_code == 404


async def test_forged_identity_headers_and_cookies_rejected(engine):
    async with make_api_client() as alice, make_api_client() as mallory:
        await register_and_login(alice)
        mallory_user = await register_and_login(mallory)
        vault = await _create_vault(alice)

        # A client-supplied user id header must not become the identity.
        spoof_headers = await mallory.get(
            f"/vaults/{vault['id']}", headers={"X-User-Id": mallory_user["id"]}
        )
        assert spoof_headers.status_code == 404

        # A fabricated session token must not authenticate at all.
        async with make_api_client() as forged:
            forged.cookies.set(COOKIE, "f" * 43)
            response = await forged.get(f"/vaults/{vault['id']}")
            assert response.status_code == 401


async def test_responses_never_contain_secret_fields(engine):
    async with make_api_client() as client:
        user = await register_and_login(client)
        vault = await _create_vault(client)
        await _create_device(vault["id"], device_id="phone-1")

        forbidden = {
            "account_password_hash",
            "password",
            "password_hash",
            "token",
            "session",
            "ciphertext",
            "nonce",
            "tag",
            "public_key",
            "kdf_params",
            "oauth_subject",
        }

        def assert_clean(payload):
            if isinstance(payload, dict):
                assert not forbidden & set(payload.keys()), payload.keys()
                for value in payload.values():
                    assert_clean(value)
            elif isinstance(payload, list):
                for item in payload:
                    assert_clean(item)

        for response in [
            await client.get("/auth/me"),
            await client.get("/vaults"),
            await client.get(f"/vaults/{vault['id']}"),
            await client.get(f"/vaults/{vault['id']}/devices"),
        ]:
            assert response.status_code == 200
            assert_clean(response.json())
            assert user["password"] not in response.text
