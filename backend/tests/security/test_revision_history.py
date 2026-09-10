"""Security-boundary tests: reading superseded revisions.

Old revisions stay on the server (docs/security-boundary.md §5: every commit
inserts a new immutable row and only moves the pointer). Exposing them for
restore must not become a second write path, must not weaken ownership, and
must not turn a read of an older revision into an advance.
"""
from __future__ import annotations

import uuid

import pytest

from tests.security.helpers import (
    _auth,
    _commit,
    _entry,
    _master_envelope,
    _sealed_manifest,
    _signup,
    _vault,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _three_revisions(client, token: str) -> str:
    """r1 empty, r2 with one entry, r3 with two."""
    vault_id = await _vault(client, token)
    first = await _commit(client, token, vault_id)
    assert first.status_code == 200, first.text
    second = await _commit(
        client,
        token,
        vault_id,
        revision=2,
        expectedRevision=1,
        entries=[_entry("entry-1")],
        sealedManifest=_sealed_manifest(),
    )
    assert second.status_code == 200, second.text
    third = await _commit(
        client,
        token,
        vault_id,
        revision=3,
        expectedRevision=2,
        entries=[_entry("entry-1"), _entry("entry-2")],
        sealedManifest=_sealed_manifest(),
    )
    assert third.status_code == 200, third.text
    return vault_id


async def test_revisions_list_is_metadata_only_newest_first(client):
    _, alice = await _signup(client)
    vault_id = await _three_revisions(client, alice)

    response = await client.get(f"/api/v1/vaults/{vault_id}/revisions", headers=_auth(alice))
    assert response.status_code == 200, response.text
    rows = response.json()

    assert [row["revision"] for row in rows] == [3, 2, 1]
    assert [row["entryCount"] for row in rows] == [2, 1, 0]
    assert [row["isActive"] for row in rows] == [True, False, False]

    # Metadata only: no ciphertext, no envelopes, no manifest leaves this route.
    body = response.text
    assert "ciphertext" not in body
    assert "envelopes" not in body
    assert "sealedManifest" not in body
    for row in rows:
        assert set(row) == {
            "revision",
            "vaultKeyVersion",
            "createdAt",
            "entryCount",
            "isActive",
        }


async def test_superseded_revision_reads_back_byte_for_byte(client):
    _, alice = await _signup(client)
    vault_id = await _three_revisions(client, alice)

    older = await client.get(f"/api/v1/vaults/{vault_id}/revisions/2", headers=_auth(alice))
    assert older.status_code == 200, older.text
    payload = older.json()

    assert payload["revision"] == 2
    assert [entry["id"] for entry in payload["entries"]] == ["entry-1"]
    assert payload["entries"][0]["ciphertext"] == _entry("entry-1")["ciphertext"]
    assert payload["sealedManifest"] == _sealed_manifest()


async def test_reading_an_old_revision_does_not_move_the_pointer(client):
    _, alice = await _signup(client)
    vault_id = await _three_revisions(client, alice)

    read = await client.get(f"/api/v1/vaults/{vault_id}/revisions/1", headers=_auth(alice))
    assert read.status_code == 200, read.text

    # The live head is untouched: a read is not a rollback.
    active = await client.get(f"/api/v1/vaults/{vault_id}/snapshot", headers=_auth(alice))
    assert active.status_code == 200, active.text
    assert active.json()["revision"] == 3

    summary = await client.get(f"/api/v1/vaults/{vault_id}", headers=_auth(alice))
    assert summary.json()["activeRevision"] == 3


async def test_restore_is_a_forward_commit_not_a_rewind(client):
    """Restoring r2's content is revision 4, not a return to revision 2."""
    _, alice = await _signup(client)
    vault_id = await _three_revisions(client, alice)

    old = await client.get(f"/api/v1/vaults/{vault_id}/revisions/2", headers=_auth(alice))
    recovered = old.json()["entries"]

    replay = await _commit(
        client,
        alice,
        vault_id,
        revision=2,
        expectedRevision=1,
        entries=recovered,
        sealedManifest=_sealed_manifest(),
    )
    assert replay.status_code == 409, replay.text

    forward = await _commit(
        client,
        alice,
        vault_id,
        revision=4,
        expectedRevision=3,
        entries=recovered,
        sealedManifest=_sealed_manifest(),
    )
    assert forward.status_code == 200, forward.text
    assert forward.json()["revision"] == 4
    assert [entry["id"] for entry in forward.json()["entries"]] == ["entry-1"]

    # r3 is still stored — restoring does not delete what it superseded.
    still_there = await client.get(f"/api/v1/vaults/{vault_id}/revisions/3", headers=_auth(alice))
    assert still_there.status_code == 200


async def test_history_is_owner_scoped(client):
    _, alice = await _signup(client)
    _, mallory = await _signup(client)
    vault_id = await _three_revisions(client, alice)

    listing = await client.get(f"/api/v1/vaults/{vault_id}/revisions", headers=_auth(mallory))
    assert listing.status_code == 404, listing.text

    single = await client.get(f"/api/v1/vaults/{vault_id}/revisions/2", headers=_auth(mallory))
    assert single.status_code == 404, single.text


async def test_unknown_revision_and_unknown_vault_are_404(client):
    _, alice = await _signup(client)
    vault_id = await _three_revisions(client, alice)

    missing = await client.get(f"/api/v1/vaults/{vault_id}/revisions/99", headers=_auth(alice))
    assert missing.status_code == 404, missing.text

    nowhere = await client.get(
        f"/api/v1/vaults/{uuid.uuid4()}/revisions", headers=_auth(alice)
    )
    assert nowhere.status_code == 404, nowhere.text


async def test_history_requires_a_session(client):
    _, alice = await _signup(client)
    vault_id = await _three_revisions(client, alice)

    assert (await client.get(f"/api/v1/vaults/{vault_id}/revisions")).status_code == 401
    assert (await client.get(f"/api/v1/vaults/{vault_id}/revisions/2")).status_code == 401


async def test_rotated_revisions_keep_their_own_vault_key_version(client):
    """History must show which key sealed each revision, so the client can say
    honestly that an older one is no longer openable after a rotation."""
    _, alice = await _signup(client)
    vault_id = await _vault(client, alice)
    assert (await _commit(client, alice, vault_id)).status_code == 200
    rotated = await _commit(
        client,
        alice,
        vault_id,
        revision=2,
        expectedRevision=1,
        vaultKeyVersion=2,
        envelopes=[_master_envelope(vault_key_version=2)],
        entries=[_entry("entry-1")],
        sealedManifest=_sealed_manifest(),
    )
    assert rotated.status_code == 200, rotated.text

    rows = (
        await client.get(f"/api/v1/vaults/{vault_id}/revisions", headers=_auth(alice))
    ).json()
    assert [(row["revision"], row["vaultKeyVersion"]) for row in rows] == [(2, 2), (1, 1)]
