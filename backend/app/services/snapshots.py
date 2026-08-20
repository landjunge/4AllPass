"""Persist and load opaque vault snapshots.

The server never decrypts envelopes, entries, or the sealed manifest. It only
checks structure, CAS (docs/vault-revision.md §4), vault-key-version
monotonicity, that a master envelope is present so the vault cannot be
committed into an unrecoverable state, that revoked device envelopes are not
re-attached, and that sealedManifest is present after the initial revision.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.encoding import b64decode, b64encode
from app.models.device import Device
from app.models.entry import EncryptedEntry
from app.models.enums import EnvelopeType
from app.models.key_envelope import KeyEnvelope
from app.models.snapshot import VaultSnapshot
from app.models.vault import Vault
from app.schemas.snapshot import (
    SnapshotCommit,
    WireEncryptedEntry,
    WireKdfParams,
    WireKeyEnvelope,
    WireSealedManifest,
    WireVaultSnapshot,
)


class RevisionConflict(Exception):
    def __init__(self, current_revision: int) -> None:
        super().__init__("revision conflict")
        self.current_revision = current_revision


def _envelope_from_wire(snapshot_id, wire: WireKeyEnvelope) -> KeyEnvelope:
    if wire.type == "device" and not wire.device_id:
        raise HTTPException(status_code=422, detail="device envelope is missing deviceId")
    if wire.type == "master" and wire.kdf is None:
        raise HTTPException(status_code=422, detail="master envelope is missing kdf")
    if wire.type != "master" and wire.kdf is not None:
        raise HTTPException(status_code=422, detail="only master envelopes may carry kdf")
    if wire.type != "device" and wire.device_id is not None:
        raise HTTPException(status_code=422, detail="deviceId is only valid on device envelopes")
    return KeyEnvelope(
        snapshot_id=snapshot_id,
        type=EnvelopeType(wire.type),
        device_id=wire.device_id,
        vault_key_version=wire.vault_key_version,
        device_key_version=wire.device_key_version,
        kdf_params=wire.kdf.model_dump(by_alias=True) if wire.kdf else None,
        encryption=wire.encryption,
        nonce=b64decode(wire.nonce, label="envelope.nonce"),
        ciphertext=b64decode(wire.ciphertext, label="envelope.ciphertext"),
        tag=b64decode(wire.tag, label="envelope.tag"),
        crypto_version=wire.version,
    )


def _entry_from_wire(snapshot_id, wire: WireEncryptedEntry) -> EncryptedEntry:
    return EncryptedEntry(
        snapshot_id=snapshot_id,
        entry_id=wire.id,
        schema_version=wire.schema_version,
        crypto_version=wire.crypto_version,
        vault_key_version=wire.vault_key_version,
        nonce=b64decode(wire.nonce, label="entry.nonce"),
        ciphertext=b64decode(wire.ciphertext, label="entry.ciphertext"),
        tag=b64decode(wire.tag, label="entry.tag"),
    )


def _sealed_manifest_to_storage(wire: WireSealedManifest | None) -> dict | None:
    if wire is None:
        return None
    # Persist the exact client-supplied strings. Do not decode/re-encode.
    return wire.model_dump(by_alias=True)


def _sealed_manifest_from_storage(value: dict | None) -> WireSealedManifest | None:
    if not value:
        return None
    return WireSealedManifest.model_validate(value)


def snapshot_to_wire(vault_id, snapshot: VaultSnapshot) -> WireVaultSnapshot:
    envelopes: list[WireKeyEnvelope] = []
    for env in snapshot.envelopes:
        kdf = None
        if env.kdf_params:
            kdf = WireKdfParams.model_validate(env.kdf_params)
        envelopes.append(
            WireKeyEnvelope(
                version=env.crypto_version,
                type=env.type.value,
                vault_key_version=env.vault_key_version,
                encryption=env.encryption,  # type: ignore[arg-type]
                nonce=b64encode(env.nonce),
                ciphertext=b64encode(env.ciphertext),
                tag=b64encode(env.tag),
                device_id=env.device_id,
                device_key_version=env.device_key_version,
                kdf=kdf,
            )
        )
    entries = [
        WireEncryptedEntry(
            id=entry.entry_id,
            schema_version=entry.schema_version,
            crypto_version=entry.crypto_version,
            vault_key_version=entry.vault_key_version,
            nonce=b64encode(entry.nonce),
            ciphertext=b64encode(entry.ciphertext),
            tag=b64encode(entry.tag),
        )
        for entry in snapshot.entries
    ]
    return WireVaultSnapshot(
        vault_id=vault_id,
        revision=snapshot.revision,
        vault_key_version=snapshot.vault_key_version,
        crypto_protocol_version=snapshot.crypto_protocol_version,
        envelopes=envelopes,
        entries=entries,
        sealed_manifest=_sealed_manifest_from_storage(snapshot.sealed_manifest),
    )


async def load_active_snapshot(db: AsyncSession, vault: Vault) -> VaultSnapshot | None:
    if vault.active_snapshot_id is None:
        return None
    result = await db.execute(
        select(VaultSnapshot)
        .where(VaultSnapshot.id == vault.active_snapshot_id)
        .options(selectinload(VaultSnapshot.envelopes), selectinload(VaultSnapshot.entries))
    )
    return result.scalar_one_or_none()


async def _lock_vault_and_current(
    db: AsyncSession, vault: Vault
) -> tuple[Vault, VaultSnapshot | None]:
    """Serialize writers and read the live CAS pointer (docs/vault-revision.md B7)."""
    result = await db.execute(
        select(Vault.active_snapshot_id).where(Vault.id == vault.id).with_for_update()
    )
    pointer = result.scalar_one()
    vault.active_snapshot_id = pointer
    if pointer is None:
        return vault, None
    snapshot = await db.execute(
        select(VaultSnapshot)
        .where(VaultSnapshot.id == pointer)
        .options(selectinload(VaultSnapshot.envelopes), selectinload(VaultSnapshot.entries))
    )
    return vault, snapshot.scalar_one_or_none()


async def commit_snapshot(db: AsyncSession, vault: Vault, payload: SnapshotCommit) -> VaultSnapshot:
    if payload.crypto_protocol_version != 1:
        raise HTTPException(status_code=422, detail="unsupported cryptoProtocolVersion")
    if not any(env.type == "master" for env in payload.envelopes):
        raise HTTPException(status_code=422, detail="snapshot must include a master envelope")

    vault, current = await _lock_vault_and_current(db, vault)
    current_revision = current.revision if current is not None else 0
    current_vault_key_version = current.vault_key_version if current is not None else 0
    expected = current_revision if payload.expected_revision is None else payload.expected_revision

    if expected != current_revision or payload.revision != current_revision + 1:
        raise RevisionConflict(current_revision)
    if payload.vault_key_version < current_vault_key_version:
        raise HTTPException(status_code=422, detail="vaultKeyVersion must not decrease")

    # After the first revision, every commit must carry a sealed manifest.
    # The server stores it opaque — it does not open it under the Vault Key.
    if current_revision >= 1 and payload.sealed_manifest is None:
        raise HTTPException(status_code=422, detail="sealedManifest is required")

    # Soft DELETE only sets revoked_at. Refuse to let a client put that device's
    # envelope back into a later snapshot (hard rotation omits it; soft omits it).
    revoked = await db.execute(
        select(Device.device_id).where(
            Device.vault_id == vault.id,
            Device.revoked_at.is_not(None),
        )
    )
    revoked_ids = set(revoked.scalars().all())
    if revoked_ids:
        for env in payload.envelopes:
            if env.type == "device" and env.device_id in revoked_ids:
                raise HTTPException(
                    status_code=422,
                    detail="snapshot includes envelope for a revoked device",
                )

    snapshot = VaultSnapshot(
        vault_id=vault.id,
        revision=payload.revision,
        vault_key_version=payload.vault_key_version,
        crypto_protocol_version=payload.crypto_protocol_version,
        sealed_manifest=_sealed_manifest_to_storage(payload.sealed_manifest),
    )
    db.add(snapshot)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise RevisionConflict(current_revision) from exc

    try:
        db.add_all([_envelope_from_wire(snapshot.id, env) for env in payload.envelopes])
        db.add_all([_entry_from_wire(snapshot.id, entry) for entry in payload.entries])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    await db.flush()
    # Flip the CAS pointer only after the new snapshot is fully written.
    vault.active_snapshot_id = snapshot.id
    await db.flush()

    result = await db.execute(
        select(VaultSnapshot)
        .where(VaultSnapshot.id == snapshot.id)
        .options(selectinload(VaultSnapshot.envelopes), selectinload(VaultSnapshot.entries))
    )
    stored = result.scalar_one()
    return stored
