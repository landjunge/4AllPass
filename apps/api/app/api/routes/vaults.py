import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.db.base import get_db
from app.db.models import KeyEnvelopeRow, User, Vault, VaultEntryRow, VaultSnapshot
from app.schemas.vault import (
    SnapshotCommitRequest,
    SnapshotOut,
    VaultCreateRequest,
    VaultOut,
)

router = APIRouter(prefix="/v1/vaults", tags=["vaults"])


def _load_vault(db: Session, vault_id: uuid.UUID) -> Vault:
    vault = db.get(Vault, vault_id)
    if vault is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vault not found")
    return vault


@router.post("", response_model=VaultOut, status_code=status.HTTP_201_CREATED)
def create_vault(body: VaultCreateRequest, db: Session = Depends(get_db)) -> Vault:
    user = db.scalar(select(User).where(User.email == body.user_email))
    if user is None:
        user = User(email=body.user_email)
        db.add(user)
        db.flush()
    vault = Vault(
        user_id=user.id,
        name=body.name,
        crypto_protocol_version=get_settings().crypto_protocol_version,
    )
    db.add(vault)
    db.commit()
    return vault


@router.get("/{vault_id}", response_model=VaultOut)
def get_vault(vault_id: uuid.UUID, db: Session = Depends(get_db)) -> Vault:
    return _load_vault(db, vault_id)


def _snapshot_to_out(snapshot: VaultSnapshot) -> SnapshotOut:
    return SnapshotOut(
        vault_id=snapshot.vault_id,
        revision=snapshot.revision,
        vault_key_version=snapshot.vault_key_version,
        crypto_protocol_version=snapshot.crypto_protocol_version,
        envelopes=[
            {
                "version": e.version,
                "type": e.type.value,
                "device_id": e.device_id,
                "kdf": None
                if e.kdf_salt is None
                else {
                    "algorithm": e.kdf_algorithm,
                    "version": e.kdf_version,
                    "memory": e.kdf_memory_kib,
                    "iterations": e.kdf_iterations,
                    "parallelism": e.kdf_parallelism,
                    "hash_len": e.kdf_hash_len,
                    "salt": e.kdf_salt,
                },
                "encryption": e.encryption,
                "nonce": e.nonce,
                "ciphertext": e.ciphertext,
                "tag": e.tag,
            }
            for e in snapshot.envelopes
        ],
        entries=[
            {
                "id": en.entry_id,
                "schema_version": en.schema_version,
                "crypto_version": en.crypto_version,
                "encryption": "AES-256-GCM",
                "nonce": en.nonce,
                "ciphertext": en.ciphertext,
                "tag": en.tag,
            }
            for en in snapshot.entries
        ],
    )


@router.get("/{vault_id}/snapshot", response_model=SnapshotOut)
def get_active_snapshot(vault_id: uuid.UUID, db: Session = Depends(get_db)) -> SnapshotOut:
    """Serve exactly the snapshot named by active_revision (vault-revision.md §2)."""
    vault = _load_vault(db, vault_id)
    if vault.active_revision is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vault has no active snapshot yet")
    snapshot = db.scalar(
        select(VaultSnapshot)
        .where(
            VaultSnapshot.vault_id == vault_id,
            VaultSnapshot.revision == vault.active_revision,
        )
        .options(
            selectinload(VaultSnapshot.envelopes),
            selectinload(VaultSnapshot.entries),
        )
    )
    if snapshot is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "active snapshot missing")
    return _snapshot_to_out(snapshot)


@router.post(
    "/{vault_id}/snapshots",
    response_model=SnapshotOut,
    status_code=status.HTTP_201_CREATED,
)
def commit_snapshot(
    vault_id: uuid.UUID,
    body: SnapshotCommitRequest,
    db: Session = Depends(get_db),
) -> SnapshotOut:
    """Commit protocol per docs/vault-revision.md §4.

    1. Validate the proposed revision against the client's expectation.
    2. Write snapshot N+1 in full (envelopes + entries). Not active yet.
    3. CAS: if active_revision == expected then active_revision = N+1.
    4. On CAS failure roll everything back and return 409; the client
       re-fetches and retries.
    """
    vault = _load_vault(db, vault_id)

    expected = body.expected_active_revision
    if body.revision != (expected or 0) + 1:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"revision must be expected_active_revision + 1 (got {body.revision})",
        )

    # vault_key_version is monotonic (vault-revision.md §1). The server cannot
    # verify ciphertext, but it can refuse an obvious downgrade.
    if expected is not None:
        current = db.scalar(
            select(VaultSnapshot.vault_key_version).where(
                VaultSnapshot.vault_id == vault_id,
                VaultSnapshot.revision == expected,
            )
        )
        if current is not None and body.vault_key_version < current:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "vault_key_version must not decrease",
            )

    snapshot = VaultSnapshot(
        vault_id=vault.id,
        revision=body.revision,
        vault_key_version=body.vault_key_version,
        crypto_protocol_version=body.crypto_protocol_version,
    )
    db.add(snapshot)
    try:
        db.flush()
    except IntegrityError:
        # Another client already wrote this revision: same outcome as losing
        # the CAS race.
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "snapshot revision already exists; re-fetch and retry",
        )

    for env in body.envelopes:
        db.add(
            KeyEnvelopeRow(
                snapshot_id=snapshot.id,
                version=env.version,
                type=env.type,
                device_id=env.device_id,
                kdf_algorithm=env.kdf.algorithm if env.kdf else None,
                kdf_version=env.kdf.version if env.kdf else None,
                kdf_memory_kib=env.kdf.memory if env.kdf else None,
                kdf_iterations=env.kdf.iterations if env.kdf else None,
                kdf_parallelism=env.kdf.parallelism if env.kdf else None,
                kdf_hash_len=env.kdf.hash_len if env.kdf else None,
                kdf_salt=env.kdf.salt if env.kdf else None,
                encryption=env.encryption,
                nonce=env.nonce,
                ciphertext=env.ciphertext,
                tag=env.tag,
            )
        )
    for entry in body.entries:
        db.add(
            VaultEntryRow(
                snapshot_id=snapshot.id,
                entry_id=entry.id,
                schema_version=entry.schema_version,
                crypto_version=entry.crypto_version,
                nonce=entry.nonce,
                ciphertext=entry.ciphertext,
                tag=entry.tag,
            )
        )
    db.flush()

    # CAS on the pointer. NULL-safe comparison covers the first commit.
    result = db.execute(
        update(Vault)
        .where(Vault.id == vault.id)
        .where(Vault.active_revision.is_not_distinct_from(expected))
        .values(active_revision=body.revision)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "active_revision changed concurrently; re-fetch and retry",
        )
    db.commit()

    db.refresh(snapshot)
    return _snapshot_to_out(snapshot)
