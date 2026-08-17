"""DB-level constraints that hold even if application validation is bypassed."""

import os
import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.db.models import (
    EnvelopeType,
    KeyEnvelopeRow,
    User,
    Vault,
    VaultSnapshot,
)


def _snapshot(db) -> VaultSnapshot:
    user = User(email=f"{uuid.uuid4()}@example.com")
    db.add(user)
    db.flush()
    vault = Vault(user_id=user.id, name="v", crypto_protocol_version=1)
    db.add(vault)
    db.flush()
    snap = VaultSnapshot(
        vault_id=vault.id, revision=1, vault_key_version=1, crypto_protocol_version=1
    )
    db.add(snap)
    db.flush()
    return snap


def _envelope_row(snapshot_id, **overrides) -> KeyEnvelopeRow:
    defaults = dict(
        snapshot_id=snapshot_id,
        version=1,
        type=EnvelopeType.recovery,
        encryption="AES-256-GCM",
        nonce=os.urandom(12),
        ciphertext=os.urandom(48),
        tag=os.urandom(16),
    )
    defaults.update(overrides)
    return KeyEnvelopeRow(**defaults)


def test_nonce_length_enforced_by_database(db_session):
    snap = _snapshot(db_session)
    db_session.add(_envelope_row(snap.id, nonce=os.urandom(8)))
    with pytest.raises(IntegrityError, match="ck_envelope_nonce_len"):
        db_session.flush()
    db_session.rollback()


def test_master_without_kdf_rejected_by_database(db_session):
    snap = _snapshot(db_session)
    db_session.add(_envelope_row(snap.id, type=EnvelopeType.master, kdf_salt=None))
    with pytest.raises(IntegrityError, match="ck_envelope_kdf_iff_master"):
        db_session.flush()
    db_session.rollback()


def test_duplicate_master_per_snapshot_rejected(db_session):
    """NULLS NOT DISTINCT keeps master envelopes unique although device_id is NULL."""
    snap = _snapshot(db_session)
    kdf = dict(
        kdf_algorithm="argon2id",
        kdf_version=19,
        kdf_memory_kib=65536,
        kdf_iterations=3,
        kdf_parallelism=4,
        kdf_hash_len=32,
        kdf_salt=os.urandom(16),
    )
    db_session.add(_envelope_row(snap.id, type=EnvelopeType.master, **kdf))
    db_session.flush()
    db_session.add(_envelope_row(snap.id, type=EnvelopeType.master, **kdf))
    with pytest.raises(IntegrityError, match="uq_envelope_snapshot_type_device"):
        db_session.flush()
    db_session.rollback()


def test_snapshot_revision_unique_per_vault(db_session):
    snap = _snapshot(db_session)
    db_session.add(
        VaultSnapshot(
            vault_id=snap.vault_id, revision=1, vault_key_version=1, crypto_protocol_version=1
        )
    )
    with pytest.raises(IntegrityError, match="uq_snapshot_vault_revision"):
        db_session.flush()
    db_session.rollback()
