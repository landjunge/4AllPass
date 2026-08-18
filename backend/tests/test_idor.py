"""Adversarial authorization tests: IDOR, enumeration, forged ownership."""

import uuid

import pytest

from tests.conftest import SESSION_COOKIE, use_session

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASSWORD = "account-password-1234"
DEVICE_A = "dev_alice_profile_000000000001"
DEVICE_B = "dev_bob_profile_000000000002"


async def _signup(client) -> str:
    email = f"idor-{uuid.uuid4().hex[:10]}@example.com"
    response = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200, response.text
    token = response.cookies.get(SESSION_COOKIE)
    assert token
    client.cookies.clear()
    return token


async def _vault_with_device(client, token: str, device_id: str) -> str:
    created = await use_session(client, token).post("/api/v1/vaults")
    assert created.status_code == 201
    vault_id = created.json()["vaultId"]
    registered = await use_session(client, token).post(
        f"/api/v1/vaults/{vault_id}/devices",
        json={"deviceId": device_id, "label": "laptop"},
    )
    assert registered.status_code == 200, registered.text
    return vault_id


async def test_forged_owner_id_does_not_create_foreign_vault(client):
    alice = await _signup(client)
    bob = await _signup(client)
    forged = await use_session(client, bob).post(
        "/api/v1/vaults",
        json={"ownerUserId": str(uuid.uuid4()), "owner_id": str(uuid.uuid4())},
    )
    assert forged.status_code == 422

    created = await use_session(client, bob).post("/api/v1/vaults", json={})
    assert created.status_code == 201
    vault_id = created.json()["vaultId"]

    alice_view = await use_session(client, alice).get(f"/api/v1/vaults/{vault_id}")
    assert alice_view.status_code == 404
    bob_list = await use_session(client, bob).get("/api/v1/vaults")
    assert [row["vaultId"] for row in bob_list.json()] == [vault_id]


async def test_missing_and_foreign_vault_are_indistinguishable(client):
    alice = await _signup(client)
    bob = await _signup(client)
    created = await use_session(client, alice).post("/api/v1/vaults")
    vault_id = created.json()["vaultId"]
    missing = uuid.uuid4()

    foreign = await use_session(client, bob).get(f"/api/v1/vaults/{vault_id}")
    absent = await use_session(client, bob).get(f"/api/v1/vaults/{missing}")
    assert foreign.status_code == 404
    assert absent.status_code == 404
    assert foreign.json() == absent.json()


async def test_device_ids_cannot_be_used_across_vaults(client):
    alice = await _signup(client)
    bob = await _signup(client)
    alice_vault = await _vault_with_device(client, alice, DEVICE_A)
    bob_vault = await _vault_with_device(client, bob, DEVICE_B)

    cross_user = await use_session(client, bob).get(
        f"/api/v1/vaults/{alice_vault}/devices/{DEVICE_A}",
    )
    assert cross_user.status_code == 404

    cross_vault = await use_session(client, bob).get(
        f"/api/v1/vaults/{bob_vault}/devices/{DEVICE_A}",
    )
    assert cross_vault.status_code == 404

    own = await use_session(client, alice).get(
        f"/api/v1/vaults/{alice_vault}/devices/{DEVICE_A}",
    )
    assert own.status_code == 200
    assert own.json()["deviceId"] == DEVICE_A


async def test_user_cannot_list_or_register_on_foreign_devices(client):
    alice = await _signup(client)
    bob = await _signup(client)
    alice_vault = await _vault_with_device(client, alice, DEVICE_A)

    listed = await use_session(client, bob).get(f"/api/v1/vaults/{alice_vault}/devices")
    assert listed.status_code == 404

    planted = await use_session(client, bob).post(
        f"/api/v1/vaults/{alice_vault}/devices",
        json={"deviceId": "dev_attacker", "label": "nope"},
    )
    assert planted.status_code == 404

    alice_list = await use_session(client, alice).get(f"/api/v1/vaults/{alice_vault}/devices")
    assert [row["deviceId"] for row in alice_list.json()] == [DEVICE_A]


async def test_authorization_happens_before_snapshot_and_device_payload(client):
    alice = await _signup(client)
    bob = await _signup(client)
    vault_id = (await use_session(client, alice).post("/api/v1/vaults")).json()["vaultId"]

    for path in (
        f"/api/v1/vaults/{vault_id}",
        f"/api/v1/vaults/{vault_id}/snapshot",
        f"/api/v1/vaults/{vault_id}/devices",
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}",
    ):
        response = await use_session(client, bob).get(path)
        assert response.status_code == 404, path
        assert "nonce" not in response.text
        assert "ciphertext" not in response.text
