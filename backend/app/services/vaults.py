"""Vault, snapshot, and commit logic.

The server's only job here is to store immutable snapshots and to move
`active_revision` forward atomically (vault-revision.md §4). It never mixes
revisions, never serves a pending snapshot, and never touches plaintext.
"""

import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.errors import ConflictError, NotFoundError, UnprocessableError
from app.models import (
    Device,
    EncryptedEntry,
    EnvelopeType,
    KeyEnvelope,
    SnapshotStatus,
    Vault,
    VaultSnapshot,
)
from app.models.base import CRYPTO_PROTOCOL_VERSION
from app.schemas.api import SnapshotCommitRequest
from app.schemas.wire import EncryptedEntry as WireEntry
from app.schemas.wire import KdfParams as WireKdf
from app.schemas.wire import KeyEnvelope as WireEnvelope


def new_vault_id() -> str:
    return f"vault_{secrets.token_hex(16)}"


async def create_vault(session: AsyncSession, account_id: uuid.UUID) -> Vault:
    """Reserve a vault id so the client can bind it into every AAD."""
    vault = Vault(
        id=new_vault_id(),
        account_id=account_id,
        crypto_protocol_version=CRYPTO_PROTOCOL_VERSION,
    )
    session.add(vault)
    await session.commit()
    await session.refresh(vault)
    return vault


async def list_vaults(session: AsyncSession, account_id: uuid.UUID) -> list[Vault]:
    result = await session.scalars(
        select(Vault).where(Vault.account_id == account_id).order_by(Vault.created_at)
    )
    return list(result)


async def get_vault(session: AsyncSession, account_id: uuid.UUID, vault_id: str) -> Vault:
    vault = await session.scalar(
        select(Vault).where(Vault.id == vault_id, Vault.account_id == account_id)
    )
    if vault is None:
        raise NotFoundError("vault not found")
    return vault


async def get_active_snapshot(session: AsyncSession, vault: Vault) -> VaultSnapshot:
    if vault.active_revision is None:
        raise NotFoundError("vault has no committed snapshot yet")
    snapshot = await session.scalar(
        select(VaultSnapshot).where(
            VaultSnapshot.vault_id == vault.id,
            VaultSnapshot.revision == vault.active_revision,
            VaultSnapshot.status == SnapshotStatus.committed,
        )
    )
    if snapshot is None:
        raise NotFoundError("active snapshot is missing")
    return snapshot


def _check_vault_key_version(vault: Vault, payload: SnapshotCommitRequest) -> None:
    current = vault.active_vault_key_version
    if current is None:
        if payload.vault_key_version != 1:
            raise UnprocessableError("the first snapshot must use vaultKeyVersion 1")
        return
    if payload.vault_key_version == current:
        return
    if payload.vault_key_version == current + 1:
        return
    raise UnprocessableError(
        f"vaultKeyVersion must stay {current} or rotate to {current + 1}, "
        f"got {payload.vault_key_version}"
    )


def _check_limits(payload: SnapshotCommitRequest, settings: Settings) -> None:
    if len(payload.entries) > settings.max_entries_per_snapshot:
        raise UnprocessableError(
            f"a snapshot may hold at most {settings.max_entries_per_snapshot} entries"
        )
    device_envelopes = [e for e in payload.envelopes if e.type == "device"]
    max_devices = settings.max_device_envelopes_per_snapshot
    if len(device_envelopes) > max_devices:
        raise UnprocessableError(f"a snapshot may hold at most {max_devices} device envelopes")
    for entry in payload.entries:
        if len(entry.ciphertext) > settings.max_entry_ciphertext_bytes:
            raise UnprocessableError(f"entry {entry.id} exceeds the maximum ciphertext size")


async def _check_device_envelopes(
    session: AsyncSession, vault: Vault, payload: SnapshotCommitRequest
) -> None:
    """Device envelopes may only exist for registered, non-revoked devices."""
    requested = {e.device_id for e in payload.envelopes if e.type == "device" and e.device_id}
    if not requested:
        return
    rows = await session.scalars(
        select(Device).where(Device.vault_id == vault.id, Device.device_id.in_(requested))
    )
    known = {device.device_id: device for device in rows}
    unknown = requested - known.keys()
    if unknown:
        raise UnprocessableError(f"device envelope for unregistered device(s): {sorted(unknown)}")
    revoked = sorted(d.device_id for d in known.values() if d.revoked_at is not None)
    if revoked:
        raise UnprocessableError(f"device envelope for revoked device(s): {revoked}")


def _envelope_row(snapshot_id: uuid.UUID, envelope: WireEnvelope) -> KeyEnvelope:
    kdf: WireKdf | None = envelope.kdf
    return KeyEnvelope(
        snapshot_id=snapshot_id,
        type=EnvelopeType(envelope.type),
        device_id=envelope.device_id,
        vault_key_version=envelope.vault_key_version,
        device_key_version=envelope.device_key_version,
        crypto_version=envelope.version,
        nonce=envelope.nonce,
        ciphertext=envelope.ciphertext,
        tag=envelope.tag,
        kdf_algorithm=kdf.algorithm if kdf else None,
        kdf_version=kdf.version if kdf else None,
        kdf_memory_kib=kdf.memory if kdf else None,
        kdf_iterations=kdf.iterations if kdf else None,
        kdf_parallelism=kdf.parallelism if kdf else None,
        kdf_hash_len=kdf.hash_len if kdf else None,
        kdf_salt=kdf.salt if kdf else None,
    )


def _entry_row(snapshot_id: uuid.UUID, entry: WireEntry) -> EncryptedEntry:
    return EncryptedEntry(
        snapshot_id=snapshot_id,
        entry_id=entry.id,
        schema_version=entry.schema_version,
        crypto_version=entry.crypto_version,
        vault_key_version=entry.vault_key_version,
        nonce=entry.nonce,
        ciphertext=entry.ciphertext,
        tag=entry.tag,
    )


async def commit_snapshot(
    session: AsyncSession,
    vault: Vault,
    payload: SnapshotCommitRequest,
    settings: Settings,
) -> VaultSnapshot:
    if payload.expected_revision != vault.active_revision:
        raise ConflictError(
            "expectedRevision does not match the active revision",
            current_revision=vault.active_revision,
            current_vault_key_version=vault.active_vault_key_version,
        )
    _check_vault_key_version(vault, payload)
    _check_limits(payload, settings)
    await _check_device_envelopes(session, vault, payload)

    snapshot = VaultSnapshot(
        vault_id=vault.id,
        revision=payload.revision,
        vault_key_version=payload.vault_key_version,
        crypto_protocol_version=payload.crypto_protocol_version,
        status=SnapshotStatus.pending,
    )
    session.add(snapshot)
    await session.flush()

    session.add_all([_envelope_row(snapshot.id, envelope) for envelope in payload.envelopes])
    session.add_all([_entry_row(snapshot.id, entry) for entry in payload.entries])
    # Everything of revision N+1 is durable before the pointer moves.
    await session.flush()

    result = await session.execute(
        update(Vault)
        .where(
            Vault.id == vault.id,
            Vault.active_revision.is_not_distinct_from(payload.expected_revision),
        )
        .values(
            active_revision=payload.revision,
            active_vault_key_version=payload.vault_key_version,
            updated_at=datetime.now(UTC),
        )
    )
    if result.rowcount != 1:
        await session.rollback()
        fresh = await session.scalar(select(Vault).where(Vault.id == vault.id))
        raise ConflictError(
            "another client committed first",
            current_revision=fresh.active_revision if fresh else None,
            current_vault_key_version=fresh.active_vault_key_version if fresh else None,
        )

    snapshot.status = SnapshotStatus.committed
    snapshot.committed_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(vault)
    await session.refresh(snapshot)
    return snapshot
