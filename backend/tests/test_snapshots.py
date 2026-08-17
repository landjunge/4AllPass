"""Snapshot commit protocol (vault-revision.md §4) and zero-knowledge validation."""

import asyncio

from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.main import create_app
from tests.conftest import (
    Api,
    b64,
    device_envelope,
    entry,
    master_envelope,
    recovery_envelope,
    snapshot,
)


async def register_device(account: Api, vault_id: str, device_id: str) -> None:
    response = await account.post(
        f"/vaults/{vault_id}/devices",
        {"deviceId": device_id, "label": "Chrome profile", "platform": "macos"},
    )
    assert response.status_code == 201, response.text


async def test_new_vault_has_no_snapshot(account: Api, vault_id: str) -> None:
    vault = (await account.get(f"/vaults/{vault_id}")).json()
    assert vault["activeRevision"] is None
    assert (await account.get(f"/vaults/{vault_id}/snapshot")).status_code == 404


async def test_commit_initial_snapshot_and_read_it_back(account: Api, vault_id: str) -> None:
    payload = snapshot(entries=[entry("entry_1"), entry("entry_2")])
    committed = await account.post(f"/vaults/{vault_id}/snapshots", payload)
    assert committed.status_code == 201, committed.text
    body = committed.json()
    assert body["revision"] == 1
    assert body["vaultKeyVersion"] == 1
    assert {e["type"] for e in body["envelopes"]} == {"master", "recovery"}

    active = await account.get(f"/vaults/{vault_id}/snapshot")
    assert active.status_code == 200
    served = active.json()
    assert served["revision"] == 1
    assert sorted(e["id"] for e in served["entries"]) == ["entry_1", "entry_2"]
    # Byte-for-byte identical blobs come back out.
    assert served["envelopes"][0]["nonce"] == body["envelopes"][0]["nonce"]
    assert served["envelopes"][0]["kdf"]["memory"] == 65536

    vault = (await account.get(f"/vaults/{vault_id}")).json()
    assert vault["activeRevision"] == 1
    assert vault["activeVaultKeyVersion"] == 1


async def test_second_commit_advances_the_revision(account: Api, vault_id: str) -> None:
    await account.post(f"/vaults/{vault_id}/snapshots", snapshot())
    second = await account.post(
        f"/vaults/{vault_id}/snapshots",
        snapshot(revision=2, expected_revision=1, entries=[entry("entry_1")]),
    )
    assert second.status_code == 201
    assert second.json()["revision"] == 2
    assert (await account.get(f"/vaults/{vault_id}/snapshot")).json()["revision"] == 2


async def test_stale_expected_revision_conflicts(account: Api, vault_id: str) -> None:
    await account.post(f"/vaults/{vault_id}/snapshots", snapshot())
    await account.post(f"/vaults/{vault_id}/snapshots", snapshot(revision=2, expected_revision=1))

    stale = await account.post(
        f"/vaults/{vault_id}/snapshots", snapshot(revision=2, expected_revision=1)
    )
    assert stale.status_code == 409
    assert stale.json()["currentRevision"] == 2


async def test_revision_must_be_exactly_one_ahead(account: Api, vault_id: str) -> None:
    await account.post(f"/vaults/{vault_id}/snapshots", snapshot())
    skipped = await account.post(
        f"/vaults/{vault_id}/snapshots", snapshot(revision=3, expected_revision=1)
    )
    assert skipped.status_code == 422


async def test_rotation_increments_vault_key_version_by_one(account: Api, vault_id: str) -> None:
    await account.post(f"/vaults/{vault_id}/snapshots", snapshot())
    rotated = await account.post(
        f"/vaults/{vault_id}/snapshots",
        snapshot(revision=2, vault_key_version=2, expected_revision=1),
    )
    assert rotated.status_code == 201
    assert (await account.get(f"/vaults/{vault_id}")).json()["activeVaultKeyVersion"] == 2

    jumped = await account.post(
        f"/vaults/{vault_id}/snapshots",
        snapshot(revision=3, vault_key_version=4, expected_revision=2),
    )
    assert jumped.status_code == 422

    downgraded = await account.post(
        f"/vaults/{vault_id}/snapshots",
        snapshot(revision=3, vault_key_version=1, expected_revision=2),
    )
    assert downgraded.status_code == 422


async def test_first_snapshot_must_start_at_vault_key_version_one(
    account: Api, vault_id: str
) -> None:
    response = await account.post(f"/vaults/{vault_id}/snapshots", snapshot(vault_key_version=2))
    assert response.status_code == 422


async def test_concurrent_commits_leave_one_winner(account: Api, vault_id: str) -> None:
    await account.post(f"/vaults/{vault_id}/snapshots", snapshot())

    app = create_app(get_settings())

    async def commit(entry_id: str) -> int:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
            racer = Api(http, get_settings().api_prefix)
            racer.token = account.token
            response = await racer.post(
                f"/vaults/{vault_id}/snapshots",
                snapshot(revision=2, expected_revision=1, entries=[entry(entry_id)]),
            )
            return response.status_code

    statuses = await asyncio.gather(commit("entry_a"), commit("entry_b"))
    assert sorted(statuses) == [201, 409]
    assert (await account.get(f"/vaults/{vault_id}/snapshot")).json()["revision"] == 2


async def test_snapshot_must_carry_exactly_one_master_envelope(account: Api, vault_id: str) -> None:
    none = await account.post(
        f"/vaults/{vault_id}/snapshots", snapshot(envelopes=[recovery_envelope()])
    )
    assert none.status_code == 422

    two = await account.post(
        f"/vaults/{vault_id}/snapshots", snapshot(envelopes=[master_envelope(), master_envelope()])
    )
    assert two.status_code == 422


async def test_device_envelope_requires_a_registered_device(account: Api, vault_id: str) -> None:
    unknown = await account.post(
        f"/vaults/{vault_id}/snapshots",
        snapshot(envelopes=[master_envelope(), device_envelope("dev_ghost")]),
    )
    assert unknown.status_code == 422
    assert "unregistered" in unknown.json()["detail"]

    await register_device(account, vault_id, "dev_real")
    known = await account.post(
        f"/vaults/{vault_id}/snapshots",
        snapshot(envelopes=[master_envelope(), device_envelope("dev_real")]),
    )
    assert known.status_code == 201


async def test_server_refuses_a_test_kdf_profile(account: Api, vault_id: str) -> None:
    weak = master_envelope()
    weak["kdf"]["memory"] = 32
    response = await account.post(f"/vaults/{vault_id}/snapshots", snapshot(envelopes=[weak]))
    assert response.status_code == 422
    assert "production floor" in response.text


async def test_server_refuses_malformed_blobs(account: Api, vault_id: str) -> None:
    cases = [
        master_envelope(nonce=b64(11)),
        master_envelope(tag=b64(15)),
        master_envelope(ciphertext=b64(48)),
        master_envelope(version=2),
        master_envelope(encryption="AES-128-GCM"),
        master_envelope(deviceId="dev_1"),
        device_envelope("dev_1", kdf=master_envelope()["kdf"]),
        device_envelope("dev_1", deviceId=None),
    ]
    for envelope in cases:
        response = await account.post(
            f"/vaults/{vault_id}/snapshots", snapshot(envelopes=[envelope])
        )
        assert response.status_code == 422, envelope

    bad_entry = await account.post(
        f"/vaults/{vault_id}/snapshots", snapshot(entries=[entry("e", nonce="not base64!")])
    )
    assert bad_entry.status_code == 422


async def test_duplicate_entry_ids_are_rejected(account: Api, vault_id: str) -> None:
    response = await account.post(
        f"/vaults/{vault_id}/snapshots", snapshot(entries=[entry("same"), entry("same")])
    )
    assert response.status_code == 422


async def test_entries_keep_their_stored_schema_version(account: Api, vault_id: str) -> None:
    await account.post(
        f"/vaults/{vault_id}/snapshots",
        snapshot(entries=[entry("v1"), entry("v7", schemaVersion=7)]),
    )
    served = (await account.get(f"/vaults/{vault_id}/snapshot")).json()
    versions = {e["id"]: e["schemaVersion"] for e in served["entries"]}
    assert versions == {"v1": 1, "v7": 7}


async def test_pending_snapshots_are_never_served(
    account: Api, vault_id: str, db_session: AsyncSession
) -> None:
    await account.post(f"/vaults/{vault_id}/snapshots", snapshot())
    # Simulate a crash between "write revision 2" and "move the pointer".
    await db_session.execute(
        text(
            "INSERT INTO vault_snapshots (id, vault_id, revision, vault_key_version, "
            "crypto_protocol_version, status) VALUES (gen_random_uuid(), :vault_id, 2, 1, 1, 'pending')"
        ),
        {"vault_id": vault_id},
    )
    await db_session.commit()

    served = (await account.get(f"/vaults/{vault_id}/snapshot")).json()
    assert served["revision"] == 1


async def test_another_account_cannot_touch_the_vault(anonymous: Api, vault_id: str) -> None:
    await anonymous.register("intruder@example.com")
    assert (await anonymous.get(f"/vaults/{vault_id}")).status_code == 404
    assert (await anonymous.get(f"/vaults/{vault_id}/snapshot")).status_code == 404
    assert (await anonymous.post(f"/vaults/{vault_id}/snapshots", snapshot())).status_code == 404


async def test_snapshot_commit_requires_authentication(api: str, vault_id: str) -> None:
    app = create_app(get_settings())
    # A fresh client: no bearer token and no session cookie.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as http:
        response = await http.post(f"{api}/vaults/{vault_id}/snapshots", json=snapshot())
    assert response.status_code == 401
