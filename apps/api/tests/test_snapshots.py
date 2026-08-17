"""Snapshot commit protocol tests (docs/vault-revision.md §4)."""

from tests.helpers import (
    commit_first_snapshot,
    create_vault,
    entry,
    master_envelope,
    recovery_envelope,
)


def test_first_commit_and_fetch_roundtrip(client):
    vault = create_vault(client)
    committed = commit_first_snapshot(client, vault["id"])

    r = client.get(f"/v1/vaults/{vault['id']}/snapshot")
    assert r.status_code == 200
    snap = r.json()
    assert snap["revision"] == 1
    assert snap["vault_key_version"] == 1
    assert snap["crypto_protocol_version"] == 1
    assert {e["type"] for e in snap["envelopes"]} == {"master", "recovery"}
    assert len(snap["entries"]) == 1

    # Byte fields survive the base64 roundtrip unchanged.
    committed_master = next(e for e in committed["envelopes"] if e["type"] == "master")
    fetched_master = next(e for e in snap["envelopes"] if e["type"] == "master")
    assert fetched_master["ciphertext"] == committed_master["ciphertext"]
    assert fetched_master["nonce"] == committed_master["nonce"]
    assert fetched_master["tag"] == committed_master["tag"]
    assert fetched_master["kdf"]["salt"] == committed_master["kdf"]["salt"]
    assert fetched_master["kdf"]["memory"] == 65536


def test_no_active_snapshot_yet(client):
    vault = create_vault(client)
    r = client.get(f"/v1/vaults/{vault['id']}/snapshot")
    assert r.status_code == 404


def test_cas_conflict_on_stale_expected_revision(client):
    vault = create_vault(client)
    commit_first_snapshot(client, vault["id"])

    # Advance to revision 2.
    body = {
        "expected_active_revision": 1,
        "revision": 2,
        "vault_key_version": 1,
        "envelopes": [master_envelope(), recovery_envelope()],
        "entries": [entry()],
    }
    r = client.post(f"/v1/vaults/{vault['id']}/snapshots", json=body)
    assert r.status_code == 201

    # A second client that still believes revision 1 is active must get 409
    # and its snapshot must not be served.
    stale = dict(body)
    r = client.post(f"/v1/vaults/{vault['id']}/snapshots", json=stale)
    assert r.status_code == 409

    r = client.get(f"/v1/vaults/{vault['id']}/snapshot")
    assert r.json()["revision"] == 2


def test_revision_must_increment_by_one(client):
    vault = create_vault(client)
    commit_first_snapshot(client, vault["id"])
    body = {
        "expected_active_revision": 1,
        "revision": 5,
        "vault_key_version": 1,
        "envelopes": [master_envelope()],
    }
    r = client.post(f"/v1/vaults/{vault['id']}/snapshots", json=body)
    assert r.status_code == 422


def test_vault_key_version_must_not_decrease(client):
    vault = create_vault(client)
    commit_first_snapshot(client, vault["id"])

    # Rotate: revision 2, vault_key_version 2.
    r = client.post(
        f"/v1/vaults/{vault['id']}/snapshots",
        json={
            "expected_active_revision": 1,
            "revision": 2,
            "vault_key_version": 2,
            "envelopes": [master_envelope(), recovery_envelope()],
        },
    )
    assert r.status_code == 201

    # Downgrade attempt: revision 3 with vault_key_version 1.
    r = client.post(
        f"/v1/vaults/{vault['id']}/snapshots",
        json={
            "expected_active_revision": 2,
            "revision": 3,
            "vault_key_version": 1,
            "envelopes": [master_envelope()],
        },
    )
    assert r.status_code == 422


def test_master_envelope_requires_kdf(client):
    vault = create_vault(client)
    bad = master_envelope()
    bad.pop("kdf")
    r = client.post(
        f"/v1/vaults/{vault['id']}/snapshots",
        json={
            "expected_active_revision": None,
            "revision": 1,
            "vault_key_version": 1,
            "envelopes": [bad],
        },
    )
    assert r.status_code == 422


def test_bad_nonce_length_rejected(client):
    vault = create_vault(client)
    bad = master_envelope()
    bad["nonce"] = "AAAA"  # 3 bytes
    r = client.post(
        f"/v1/vaults/{vault['id']}/snapshots",
        json={
            "expected_active_revision": None,
            "revision": 1,
            "vault_key_version": 1,
            "envelopes": [bad],
        },
    )
    assert r.status_code == 422
