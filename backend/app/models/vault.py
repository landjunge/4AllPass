"""Vaults, immutable snapshots, key envelopes, and encrypted entries.

Everything stored here is opaque. The server keeps `active_revision` as the
single pointer clients are allowed to read (vault-revision.md §2) and never
assembles a vault from envelopes of one revision and entries of another.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import BYTEA, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import (
    CRYPTO_PROTOCOL_VERSION,
    KEY_BYTES,
    NONCE_BYTES,
    SALT_MAX_BYTES,
    SALT_MIN_BYTES,
    TAG_BYTES,
    Base,
    created_at,
    nullable_timestamp,
    uuid_pk,
)


class EnvelopeType(enum.StrEnum):
    master = "master"
    device = "device"
    recovery = "recovery"


class SnapshotStatus(enum.StrEnum):
    #: Written in full but not yet pointed at by active_revision.
    pending = "pending"
    #: Durable and servable.
    committed = "committed"


envelope_type_enum = Enum(
    EnvelopeType, name="envelope_type", values_callable=lambda e: [m.value for m in e]
)
snapshot_status_enum = Enum(
    SnapshotStatus, name="snapshot_status", values_callable=lambda e: [m.value for m in e]
)


class Vault(Base):
    __tablename__ = "vaults"
    __table_args__ = (
        CheckConstraint(
            "active_revision IS NULL OR active_revision >= 1", name="active_revision_positive"
        ),
        CheckConstraint(
            "(active_revision IS NULL) = (active_vault_key_version IS NULL)",
            name="active_pointer_consistent",
        ),
        CheckConstraint(
            f"crypto_protocol_version = {CRYPTO_PROTOCOL_VERSION}",
            name="crypto_protocol_version_v1",
        ),
    )

    #: The `vault_id` bound into every AAD. Server-generated, immutable.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    crypto_protocol_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=CRYPTO_PROTOCOL_VERSION
    )
    #: Compare-and-set target. NULL until the first snapshot is committed.
    active_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active_vault_key_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime | None] = nullable_timestamp()

    account: Mapped["Account"] = relationship(back_populates="vaults")  # noqa: F821
    snapshots: Mapped[list["VaultSnapshot"]] = relationship(
        back_populates="vault", cascade="all, delete-orphan"
    )
    devices: Mapped[list["Device"]] = relationship(  # noqa: F821
        back_populates="vault", cascade="all, delete-orphan"
    )


class VaultSnapshot(Base):
    """One immutable revision: all envelopes plus all entries under one VK."""

    __tablename__ = "vault_snapshots"
    __table_args__ = (
        UniqueConstraint("vault_id", "revision"),
        CheckConstraint("revision >= 1", name="revision_positive"),
        CheckConstraint("vault_key_version >= 1", name="vault_key_version_positive"),
        CheckConstraint(
            f"crypto_protocol_version = {CRYPTO_PROTOCOL_VERSION}",
            name="crypto_protocol_version_v1",
        ),
        CheckConstraint(
            "(status = 'committed') = (committed_at IS NOT NULL)",
            name="committed_at_matches_status",
        ),
        Index("ix_vault_snapshots_vault_id_status", "vault_id", "status"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    vault_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    vault_key_version: Mapped[int] = mapped_column(Integer, nullable=False)
    crypto_protocol_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=CRYPTO_PROTOCOL_VERSION
    )
    status: Mapped[SnapshotStatus] = mapped_column(
        snapshot_status_enum, nullable=False, default=SnapshotStatus.pending
    )
    created_at: Mapped[datetime] = created_at()
    committed_at: Mapped[datetime | None] = nullable_timestamp()

    vault: Mapped[Vault] = relationship(back_populates="snapshots")
    envelopes: Mapped[list["KeyEnvelope"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan", lazy="selectin"
    )
    entries: Mapped[list["EncryptedEntry"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan", lazy="selectin"
    )


class KeyEnvelope(Base):
    """A wrapped Vault Key. The server can never unwrap one."""

    __tablename__ = "key_envelopes"
    __table_args__ = (
        # NULLS NOT DISTINCT: one master and one recovery envelope per snapshot,
        # and at most one envelope per device.
        UniqueConstraint("snapshot_id", "type", "device_id", postgresql_nulls_not_distinct=True),
        CheckConstraint(f"crypto_version = {CRYPTO_PROTOCOL_VERSION}", name="crypto_version_v1"),
        CheckConstraint(f"octet_length(nonce) = {NONCE_BYTES}", name="nonce_length"),
        CheckConstraint(
            f"octet_length(ciphertext) = {KEY_BYTES}", name="ciphertext_is_wrapped_key"
        ),
        CheckConstraint(f"octet_length(tag) = {TAG_BYTES}", name="tag_length"),
        CheckConstraint(
            "(type = 'device') = (device_id IS NOT NULL)", name="device_id_only_on_device_envelope"
        ),
        # KDF parameters live inside the master envelope and nowhere else.
        CheckConstraint(
            "(type = 'master') = (kdf_algorithm IS NOT NULL)", name="kdf_only_on_master_envelope"
        ),
        CheckConstraint(
            "kdf_algorithm IS NULL OR ("
            "kdf_algorithm = 'argon2id' AND kdf_version = 19 AND kdf_hash_len = 32 "
            "AND kdf_iterations >= 1 AND kdf_parallelism >= 1 "
            f"AND octet_length(kdf_salt) BETWEEN {SALT_MIN_BYTES} AND {SALT_MAX_BYTES})",
            name="kdf_parameters_valid",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vault_snapshots.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[EnvelopeType] = mapped_column(envelope_type_enum, nullable=False)
    #: Set only for device envelopes; matches devices.device_id.
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    crypto_version: Mapped[int] = mapped_column(Integer, nullable=False)
    nonce: Mapped[bytes] = mapped_column(BYTEA, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(BYTEA, nullable=False)
    tag: Mapped[bytes] = mapped_column(BYTEA, nullable=False)

    kdf_algorithm: Mapped[str | None] = mapped_column(String(32), nullable=True)
    kdf_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kdf_memory_kib: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kdf_iterations: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kdf_parallelism: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kdf_hash_len: Mapped[int | None] = mapped_column(Integer, nullable=True)
    kdf_salt: Mapped[bytes | None] = mapped_column(BYTEA, nullable=True)

    snapshot: Mapped[VaultSnapshot] = relationship(back_populates="envelopes")


class EncryptedEntry(Base):
    __tablename__ = "encrypted_entries"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "entry_id"),
        CheckConstraint(f"crypto_version = {CRYPTO_PROTOCOL_VERSION}", name="crypto_version_v1"),
        CheckConstraint("schema_version >= 1", name="schema_version_positive"),
        CheckConstraint(f"octet_length(nonce) = {NONCE_BYTES}", name="nonce_length"),
        CheckConstraint(f"octet_length(tag) = {TAG_BYTES}", name="tag_length"),
        CheckConstraint("octet_length(ciphertext) >= 1", name="ciphertext_not_empty"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vault_snapshots.id", ondelete="CASCADE"), nullable=False
    )
    entry_id: Mapped[str] = mapped_column(String(128), nullable=False)
    #: Plaintext JSON schema version, stored so a client never guesses it.
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    crypto_version: Mapped[int] = mapped_column(Integer, nullable=False)
    nonce: Mapped[bytes] = mapped_column(BYTEA, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(BYTEA, nullable=False)
    tag: Mapped[bytes] = mapped_column(BYTEA, nullable=False)

    snapshot: Mapped[VaultSnapshot] = relationship(back_populates="entries")
