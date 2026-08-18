import asyncio

import pytest

from tests.helpers import (
    auth,
    commit_revision,
    create_vault,
    master_envelope,
    opaque_entry,
    signup,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_stale_revision_is_conflict(client):
    _, token = await signup(client)
    vault_id = await create_vault(client, token)
    first = await commit_revision(client, token, vault_id, revision=1, expected=0)
    assert first.status_code == 200
    stale = await commit_revision(client, token, vault_id, revision=1, expected=0)
    assert stale.status_code == 409
    assert stale.json()["currentRevision"] == 1
    skip = await commit_revision(client, token, vault_id, revision=3, expected=1)
    assert skip.status_code == 409


async def test_vault_key_version_cannot_decrease(client):
    _, token = await signup(client)
    vault_id = await create_vault(client, token)
    first = await commit_revision(client, token, vault_id, revision=1, expected=0, vault_key_version=2)
    assert first.status_code == 200
    downgrade = await commit_revision(client, token, vault_id, revision=2, expected=1, vault_key_version=1)
    assert downgrade.status_code == 422


async def test_snapshot_preserves_opaque_bytes_and_rejects_plaintext_fields(client):
    _, token = await signup(client)
    vault_id = await create_vault(client, token)
    entry = opaque_entry()
    committed = await commit_revision(
        client,
        token,
        vault_id,
        revision=1,
        expected=0,
        entries=[entry],
    )
    assert committed.status_code == 200, committed.text
    body = committed.json()
    assert body["revision"] == 1
    assert body["vaultKeyVersion"] == 1
    assert body["cryptoProtocolVersion"] == 1
    assert body["entries"][0]["ciphertext"] == entry["ciphertext"]
    assert body["entries"][0]["nonce"] == entry["nonce"]
    assert body["entries"][0]["tag"] == entry["tag"]
    assert body["envelopes"][0]["ciphertext"] == master_envelope()["ciphertext"]
    dumped = committed.text
    assert "account_password_hash" not in dumped
    assert "$argon2" not in dumped.lower()
    assert "masterPassword" not in dumped
    assert "prfOutput" not in dumped

    fetched = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=auth(token))
    assert fetched.status_code == 200
    assert fetched.json()["entries"][0] == body["entries"][0]
    assert fetched.json()["envelopes"][0]["kdf"]["salt"] == master_envelope()["kdf"]["salt"]


async def test_foreign_user_cannot_submit_snapshot(client):
    _, alice = await signup(client)
    _, bob = await signup(client)
    vault_id = await create_vault(client, alice)
    response = await commit_revision(client, bob, vault_id, revision=1, expected=0)
    assert response.status_code == 404


async def test_concurrent_revision_writes_one_winner(client):
    _, token = await signup(client)
    vault_id = await create_vault(client, token)
    first = await commit_revision(client, token, vault_id, revision=1, expected=0)
    assert first.status_code == 200

    async def write(ciphertext_tag: str):
        envelope = master_envelope()
        envelope = {**envelope, "tag": ciphertext_tag}
        return await commit_revision(
            client,
            token,
            vault_id,
            revision=2,
            expected=1,
            envelopes=[envelope],
        )

    a, b = await asyncio.gather(
        write("AgICAgICAgICAgICAgICAg=="),
        write("AwMDAwMDAwMDAwMDAwMDAw=="),
    )
    statuses = sorted([a.status_code, b.status_code])
    assert statuses == [200, 409], (a.status_code, a.text, b.status_code, b.text)
    winner = a if a.status_code == 200 else b
    current = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=auth(token))
    assert current.json()["revision"] == 2
    assert current.json()["envelopes"][0]["tag"] == winner.json()["envelopes"][0]["tag"]


async def test_snapshot_requires_master_envelope(client):
    _, token = await signup(client)
    vault_id = await create_vault(client, token)
    response = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=auth(token),
        json={
            "revision": 1,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "envelopes": [],
            "entries": [],
        },
    )
    assert response.status_code == 422
