"""Vault ownership: the boundary between "who is calling" and "what they may read"."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.vault import Vault
from tests.helpers import create_vault, register_and_login

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_creating_a_vault_requires_authentication(anonymous_client):
    response = await anonymous_client.post("/vaults", json={})
    assert response.status_code == 401


async def test_listing_vaults_requires_authentication(anonymous_client):
    assert (await anonymous_client.get("/vaults")).status_code == 401


async def test_reading_a_vault_requires_authentication(anonymous_client):
    response = await anonymous_client.get(f"/vaults/{uuid.uuid4()}")
    assert response.status_code == 401


async def test_create_vault_returns_metadata_only(client):
    await register_and_login(client)

    response = await client.post("/vaults", json={})

    assert response.status_code == 201
    body = response.json()
    assert set(body) == {
        "id",
        "crypto_protocol_version",
        "active_revision",
        "created_at",
        "updated_at",
    }
    assert body["crypto_protocol_version"] == 1
    # No snapshot exists until the client publishes revision 1 itself.
    assert body["active_revision"] is None


async def test_create_vault_assigns_ownership_from_the_session(client, db_session):
    account = await register_and_login(client)

    vault_id = await create_vault(client)

    vault = (
        await db_session.execute(select(Vault).where(Vault.id == uuid.UUID(vault_id)))
    ).scalar_one()
    assert str(vault.owner_user_id) == account.user_id


async def test_create_vault_does_not_generate_or_store_key_material(client, db_session):
    """The server's part in vault creation is a row, not a key.

    crypto-protocol.md §2 and Hard Invariant #1: the Vault Key is 256 random
    bits generated on the client. A freshly created vault therefore has no
    snapshot, no envelope and no entry — there is nothing here that could wrap
    or hold a key.
    """
    await register_and_login(client)

    vault_id = await create_vault(client)

    vault = (
        await db_session.execute(select(Vault).where(Vault.id == uuid.UUID(vault_id)))
    ).scalar_one()
    assert vault.active_snapshot_id is None
    assert {column.name for column in Vault.__table__.columns} == {
        "id",
        "owner_user_id",
        "crypto_protocol_version",
        "active_snapshot_id",
        "created_at",
        "updated_at",
    }


async def test_create_vault_rejects_an_unsupported_protocol_version(client):
    await register_and_login(client)

    response = await client.post("/vaults", json={"crypto_protocol_version": 2})
    assert response.status_code == 400


async def test_owner_can_read_their_own_vault(client):
    await register_and_login(client)
    vault_id = await create_vault(client)

    response = await client.get(f"/vaults/{vault_id}")

    assert response.status_code == 200
    assert response.json()["id"] == vault_id


async def test_list_vaults_returns_only_the_callers_own(client, other_client):
    await register_and_login(client)
    mine = await create_vault(client)

    await register_and_login(other_client)
    theirs = await create_vault(other_client)

    listed = {vault["id"] for vault in (await client.get("/vaults")).json()}

    assert mine in listed
    assert theirs not in listed


async def test_another_user_cannot_read_a_vault_they_do_not_own(client, other_client):
    await register_and_login(client)
    victim_vault = await create_vault(client)

    await register_and_login(other_client)

    response = await other_client.get(f"/vaults/{victim_vault}")

    # 404, not 403: a 403 would confirm the id names a real vault.
    assert response.status_code == 404


async def test_a_foreign_vault_is_indistinguishable_from_one_that_does_not_exist(
    client, other_client
):
    await register_and_login(client)
    victim_vault = await create_vault(client)

    await register_and_login(other_client)

    foreign = await other_client.get(f"/vaults/{victim_vault}")
    nonexistent = await other_client.get(f"/vaults/{uuid.uuid4()}")

    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.json() == nonexistent.json()


async def test_an_unauthenticated_read_cannot_tell_a_real_vault_from_a_fake_one(
    client, anonymous_client
):
    await register_and_login(client)
    real_vault = await create_vault(client)

    real = await anonymous_client.get(f"/vaults/{real_vault}")
    fake = await anonymous_client.get(f"/vaults/{uuid.uuid4()}")

    # Authentication is checked before ownership, so neither answer says
    # anything about whether the id exists.
    assert real.status_code == fake.status_code == 401
    assert real.json() == fake.json()
