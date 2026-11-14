"""P04 syntactic binding only: opaque manifests, synthetic signed requests."""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.signed_writes import sealed_manifest_digest
from app.core.write_request import write_payload_digest_v2
from app.models.entry import EncryptedEntry
from app.models.key_envelope import KeyEnvelope
from app.models.signed_write import VaultWriteKey, WriteGrant, WriteNonce, WriteReceipt
from app.models.snapshot import VaultSnapshot
from app.models.vault import Vault
from test_signed_writes import (
    DEVICE,
    _bootstrap_device,
    _commit,
    _create_v2_vault,
    account as account,  # Explicitly re-export the scoped opt-in fixture.
    body_bytes,
    envelope,
    manifest,
    sign,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def _binding_state(engine, vault_id):
    """Capture exact stored data, keys, nonces, receipts and bootstrap grants."""
    vault_uuid = uuid.UUID(vault_id)
    snapshots = select(VaultSnapshot.id).where(VaultSnapshot.vault_id == vault_uuid)
    models = [
        (Vault, Vault.id == vault_uuid),
        (VaultSnapshot, VaultSnapshot.vault_id == vault_uuid),
        (KeyEnvelope, KeyEnvelope.snapshot_id.in_(snapshots)),
        (EncryptedEntry, EncryptedEntry.snapshot_id.in_(snapshots)),
        (VaultWriteKey, VaultWriteKey.vault_id == vault_uuid),
        (WriteNonce, WriteNonce.vault_id == vault_uuid),
        (WriteReceipt, WriteReceipt.vault_id == vault_uuid),
        (WriteGrant, WriteGrant.vault_id == vault_uuid),
    ]
    state = {}
    async with AsyncSession(bind=engine) as db:
        for model, predicate in models:
            table = model.__table__
            rows = await db.execute(select(table).where(predicate).order_by(*table.primary_key.columns))
            state[table.name] = [dict(row) for row in rows.mappings()]
    return state


def _signed_snapshot(vault_id, priv, pub, payload):
    raw = body_bytes(payload)
    sealed = payload.get("sealedManifest")
    signed, _ = sign(
        priv=priv, pub=pub, vault_id=vault_id, device_id=DEVICE,
        method="POST", route="/api/v1/vaults/{vaultId}/snapshots",
        resource_type="vault", resource_id="", parent_id="",
        base=payload["expectedRevision"], result=payload["revision"],
        key_version=1, result_key_version=1,
        has_manifest=sealed is not None,
        manifest_digest=sealed_manifest_digest(sealed) if sealed is not None else b"",
        payload_digest=write_payload_digest_v2(raw),
        operation_id=uuid.uuid4(), nonce=uuid.uuid4().bytes,
    )
    return signed, raw


@pytest.mark.parametrize("base", [0, 1], ids=["initial", "existing-head"])
@pytest.mark.parametrize("bad", ["missing", "null", 1, 3])
async def test_v2_rejects_unbound_manifest_without_effect(client, account, engine, base, bad):
    vault_id, grant = await _create_v2_vault(client, account)
    priv, pub = await _bootstrap_device(client, account, vault_id, grant)
    if base:
        first, _, _ = await _commit(
            client, account, vault_id, priv, pub,
            revision=1, base=0, key_version=1, result_key_version=1,
            manifest_obj=manifest(version=2),
        )
        assert first.status_code == 200, first.text
    before = await _binding_state(engine, vault_id)
    payload = {
        "expectedRevision": base, "revision": base + 1,
        "vaultKeyVersion": 1, "cryptoProtocolVersion": 2,
        "envelopes": [envelope()], "entries": [],
    }
    if bad != "missing":
        payload["sealedManifest"] = None if bad == "null" else manifest(version=bad)
    signed, raw = _signed_snapshot(vault_id, priv, pub, payload)
    response = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **signed},
    )
    assert response.status_code == 422, response.text
    detail = "sealedManifest is required" if bad in ("missing", "null") else "sealedManifest.version does not match snapshot"
    assert response.json()["detail"] == detail  # Must reach binding, not signature rejection.
    assert await _binding_state(engine, vault_id) == before

    # The refused write did not consume a receipt/nonce or poison the next head.
    good, good_headers, good_raw = await _commit(
        client, account, vault_id, priv, pub,
        revision=base + 1, base=base, key_version=1, result_key_version=1,
        manifest_obj=manifest(version=2),
    )
    assert good.status_code == 200, good.text
    assert good.json()["sealedManifest"]["version"] == 2
    accepted = await _binding_state(engine, vault_id)
    replay = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=good_raw, headers=good_headers,
    )
    assert replay.status_code == 200, replay.text
    assert replay.headers.get("X-4AP-Write-Replayed") == "true"
    assert await _binding_state(engine, vault_id) == accepted


async def test_v1_rejects_manifest2_and_retains_unsigned_legacy_bootstrap(client, account, engine):
    created = await client.post("/api/v1/vaults", json={"cryptoProtocolVersion": 1}, headers=account)
    assert created.status_code == 201, created.text
    vault_id = created.json()["vaultId"]
    before = await _binding_state(engine, vault_id)
    payload = {
        "expectedRevision": 0, "revision": 1, "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 1, "envelopes": [envelope()], "entries": [],
        "sealedManifest": manifest(version=2),
    }
    # V1 intentionally has no authorized signed-write path. A correctly signed
    # request still hits that existing refusal; unsigned reaches the new guard.
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    priv = Ed25519PrivateKey.generate()
    signed, raw = _signed_snapshot(vault_id, priv, priv.public_key().public_bytes_raw(), payload)
    refused_signed = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots", content=raw, headers={**account, **signed},
    )
    assert refused_signed.status_code == 422, refused_signed.text
    assert refused_signed.json()["detail"] == "signed_write_not_supported_for_v1"
    assert await _binding_state(engine, vault_id) == before
    refused = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", json=payload, headers=account)
    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"] == "sealedManifest.version does not match snapshot"
    assert await _binding_state(engine, vault_id) == before
    del payload["sealedManifest"]
    first = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", json=payload, headers=account)
    assert first.status_code == 200, first.text
    assert first.json()["sealedManifest"] is None
    second_payload = {**payload, "expectedRevision": 1, "revision": 2, "sealedManifest": manifest()}
    second = await client.post(f"/api/v1/vaults/{vault_id}/snapshots", json=second_payload, headers=account)
    assert second.status_code == 200, second.text
    assert second.json()["sealedManifest"]["version"] == 1
