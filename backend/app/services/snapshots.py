"""Persist and load opaque vault snapshots.

The server never decrypts envelopes, entries, or the sealed manifest. It only
checks structure, CAS (docs/vault-revision.md §4), monotonic counters, and
that a master envelope is present so the vault cannot be committed into an
unrecoverable state.

Publication is serialized on the vault row (SELECT FOR UPDATE). The unique
constraint on ``(vault_id, revision)`` is a second fence: a lost race becomes
a deterministic revision conflict, never a mixed snapshot.
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


def _manifest_to_wire(snapshot: VaultSnapshot) -> WireSealedManifest | None:
    if (
        snapshot.manifest_nonce is None
        or snapshot.manifest_ciphertext is None
        or snapshot.manifest_tag is None
        or snapshot.manifest_crypto_version is None
    ):
        return None
    return WireSealedManifest(
        version=snapshot.manifest_crypto_version,
        encryption="AES-256-GCM",
        nonce=b64encode(snapshot.manifest_nonce),
        ciphertext=b64encode(snapshot.manifest_ciphertext),
        tag=b64encode(snapshot.manifest_tag),
    )


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
        manifest=_manifest_to_wire(snapshot),
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


async def _lock_vault(db: AsyncSession, vault_id) -> Vault:
    # Must hit the database and refresh the identity map. A cached Vault from
    # get_owned_vault would otherwise keep a stale active_snapshot_id and two
    # concurrent writers would both believe they hold revision N.
    await db.execute(select(Vault.id).where(Vault.id == vault_id).with_for_update())
    result = await db.execute(
        select(Vault).where(Vault.id == vault_id),
        execution_options={"populate_existing": True},
    )
    locked = result.scalar_one_or_none()
    if locked is None:
        raise HTTPException(status_code=404, detail="vault not found")
    return locked


async def _revoked_device_ids(db: AsyncSession, vault_id) -> set[str]:
    result = await db.execute(
        select(Device.device_id).where(Device.vault_id == vault_id, Device.revoked_at.is_not(None))
    )
    return {row[0] for row in result.all()}


def _decode_manifest(wire: WireSealedManifest) -> tuple[int, bytes, bytes, bytes]:
    try:
        nonce = b64decode(wire.nonce, label="manifest.nonce")
        ciphertext = b64decode(wire.ciphertext, label="manifest.ciphertext")
        tag = b64decode(wire.tag, label="manifest.tag")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if len(nonce) != 12:
        raise HTTPException(status_code=422, detail="manifest.nonce must be 12 bytes")
    if len(tag) != 16:
        raise HTTPException(status_code=422, detail="manifest.tag must be 16 bytes")
    if len(ciphertext) == 0:
        raise HTTPException(status_code=422, detail="manifest.ciphertext must not be empty")
    return wire.version, nonce, ciphertext, tag


async def commit_snapshot(db: AsyncSession, vault: Vault, payload: SnapshotCommit) -> VaultSnapshot:
    if payload.crypto_protocol_version != 1:
        raise HTTPException(status_code=422, detail="unsupported cryptoProtocolVersion")
    if not any(env.type == "master" for env in payload.envelopes):
        raise HTTPException(status_code=422, detail="snapshot must include a master envelope")

    vault = await _lock_vault(db, vault.id)
    current = await load_active_snapshot(db, vault)
    current_revision = current.revision if current is not None else 0
    expected = current_revision if payload.expected_revision is None else payload.expected_revision

    if expected != current_revision or payload.revision != current_revision + 1:
        raise RevisionConflict(current_revision)

    if current is None:
        if payload.vault_key_version != 1:
            raise HTTPException(status_code=422, detail="first snapshot must use vaultKeyVersion 1")
    else:
        if payload.vault_key_version < current.vault_key_version:
            raise HTTPException(status_code=422, detail="vaultKeyVersion must not decrease")
        if payload.vault_key_version > current.vault_key_version + 1:
            raise HTTPException(status_code=422, detail="vaultKeyVersion may increase by at most 1")

    revoked = await _revoked_device_ids(db, vault.id)
    for env in payload.envelopes:
        if env.type == "device" and env.device_id in revoked:
            raise HTTPException(
                status_code=422,
                detail="snapshot includes an envelope for a revoked device",
            )

    version, nonce, ciphertext, tag = _decode_manifest(payload.manifest)

    snapshot = VaultSnapshot(
        vault_id=vault.id,
        revision=payload.revision,
        vault_key_version=payload.vault_key_version,
        crypto_protocol_version=payload.crypto_protocol_version,
        manifest_crypto_version=version,
        manifest_nonce=nonce,
        manifest_ciphertext=ciphertext,
        manifest_tag=tag,
    )
    db.add(snapshot)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        reread = await db.execute(select(Vault).where(Vault.id == vault.id))
        latest = reread.scalar_one()
        current = await load_active_snapshot(db, latest)
        raise RevisionConflict(current.revision if current is not None else 0) from exc

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
