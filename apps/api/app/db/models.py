"""4AllPass server-side schema.

Zero-knowledge rules (docs/crypto-protocol.md §11): every BYTEA column in this
schema holds ciphertext, nonces, auth tags, salts, or WebAuthn public material.
The server never stores the Master Password, the Vault Key, a Device Key, or
any plaintext entry data.

Snapshot / revision model per docs/vault-revision.md: snapshots are immutable,
clients only read the snapshot named by ``vaults.active_revision``, and every
commit flips that pointer with a compare-and-swap.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class EnvelopeType(enum.Enum):
    master = "master"
    device = "device"
    recovery = "recovery"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    # Account password hash only. Account login has zero influence on vault
    # decryption (crypto-protocol.md §1, hard invariant 5).
    password_hash: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    vaults: Mapped[list["Vault"]] = relationship(back_populates="user")


class Vault(Base):
    __tablename__ = "vaults"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    crypto_protocol_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Pointer to the single served snapshot (vault-revision.md §2).
    # NULL until the first snapshot commit. Flipped only via CAS.
    active_revision: Mapped[int | None] = mapped_column(BigInteger)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(back_populates="vaults")
    snapshots: Mapped[list["VaultSnapshot"]] = relationship(back_populates="vault")
    devices: Mapped[list["Device"]] = relationship(back_populates="vault")


class VaultSnapshot(Base):
    """Immutable snapshot: complete envelope set + complete entry set.

    There is no "current envelopes + current entries" assembled from different
    revisions (vault-revision.md §2). Rows are written in full before the
    vault's active_revision CAS; a snapshot that never became active may be
    garbage-collected.
    """

    __tablename__ = "vault_snapshots"
    __table_args__ = (
        UniqueConstraint("vault_id", "revision", name="uq_snapshot_vault_revision"),
        CheckConstraint("revision >= 1", name="ck_snapshot_revision_positive"),
        CheckConstraint("vault_key_version >= 1", name="ck_snapshot_vkv_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    vault_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    vault_key_version: Mapped[int] = mapped_column(BigInteger, nullable=False)
    crypto_protocol_version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    vault: Mapped[Vault] = relationship(back_populates="snapshots")
    envelopes: Mapped[list["KeyEnvelopeRow"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan"
    )
    entries: Mapped[list["VaultEntryRow"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan"
    )


class KeyEnvelopeRow(Base):
    """One KeyEnvelope (crypto-protocol.md §3) inside a snapshot.

    ``ciphertext`` is the AES-256-GCM wrap of the Vault Key; the tag is stored
    separately (storage concatenation ``ciphertext || tag`` happens on the
    client). KDF parameters are present only for type = master so the client
    can always re-derive the Master Key (crypto-protocol.md §9).
    """

    __tablename__ = "key_envelopes"
    __table_args__ = (
        # NULLS NOT DISTINCT: master/recovery rows have device_id = NULL and
        # must still be unique per snapshot.
        UniqueConstraint(
            "snapshot_id",
            "type",
            "device_id",
            name="uq_envelope_snapshot_type_device",
            postgresql_nulls_not_distinct=True,
        ),
        CheckConstraint(
            "(type = 'device') = (device_id IS NOT NULL)",
            name="ck_envelope_device_id_iff_device",
        ),
        CheckConstraint(
            "(type = 'master') = (kdf_salt IS NOT NULL)",
            name="ck_envelope_kdf_iff_master",
        ),
        CheckConstraint("octet_length(nonce) = 12", name="ck_envelope_nonce_len"),
        CheckConstraint("octet_length(tag) = 16", name="ck_envelope_tag_len"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vault_snapshots.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[EnvelopeType] = mapped_column(
        Enum(EnvelopeType, name="envelope_type", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )

    # type == "device" only: stable device/profile identity this envelope belongs to.
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("devices.id", ondelete="RESTRICT")
    )

    # type == "master" only: Argon2id parameters + salt (crypto-protocol.md §4).
    kdf_algorithm: Mapped[str | None] = mapped_column(String(32))
    kdf_version: Mapped[int | None] = mapped_column(Integer)
    kdf_memory_kib: Mapped[int | None] = mapped_column(Integer)
    kdf_iterations: Mapped[int | None] = mapped_column(Integer)
    kdf_parallelism: Mapped[int | None] = mapped_column(Integer)
    kdf_hash_len: Mapped[int | None] = mapped_column(Integer)
    kdf_salt: Mapped[bytes | None] = mapped_column(LargeBinary)

    encryption: Mapped[str] = mapped_column(String(32), nullable=False, default="AES-256-GCM")
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    tag: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    snapshot: Mapped[VaultSnapshot] = relationship(back_populates="envelopes")
    device: Mapped["Device | None"] = relationship()


class VaultEntryRow(Base):
    """One EncryptedEntry (crypto-protocol.md §8) inside a snapshot.

    ``schema_version`` and ``crypto_version`` are stored, never guessed: the
    client reads them from the entry when decrypting.
    """

    __tablename__ = "vault_entries"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "entry_id", name="uq_entry_snapshot_entry"),
        CheckConstraint("octet_length(nonce) = 12", name="ck_entry_nonce_len"),
        CheckConstraint("octet_length(tag) = 16", name="ck_entry_tag_len"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vault_snapshots.id", ondelete="CASCADE"), nullable=False, index=True
    )
    entry_id: Mapped[str] = mapped_column(String(255), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    crypto_version: Mapped[int] = mapped_column(Integer, nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    tag: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    snapshot: Mapped[VaultSnapshot] = relationship(back_populates="entries")


class Device(Base):
    """Registered device / browser profile (architecture.md §4).

    Access is controlled cryptographically by the presence of a device
    envelope in the active snapshot, not by a flag. ``revoked_at`` is
    metadata for the UI; soft revocation removes the envelope from the next
    snapshot, hard revocation additionally rotates the Vault Key.
    """

    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    vault_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    user_agent_summary: Mapped[str | None] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    vault: Mapped[Vault] = relationship(back_populates="devices")
    webauthn_credentials: Mapped[list["WebAuthnCredential"]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )
    device_key_envelopes: Mapped[list["DeviceKeyEnvelopeRow"]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )


class WebAuthnCredential(Base):
    """WebAuthn credential metadata (docs/webauthn-prf.md §2.1).

    Stores only public material: credential id, COSE public key, sign count.
    The PRF output, DWK, and DK never reach the server.
    """

    __tablename__ = "webauthn_credentials"
    __table_args__ = (
        UniqueConstraint("credential_id", name="uq_webauthn_credential_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    credential_id: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    public_key_cose: Mapped[bytes | None] = mapped_column(LargeBinary)
    rp_id: Mapped[str] = mapped_column(String(255), nullable=False)
    aaguid: Mapped[uuid.UUID | None] = mapped_column()
    sign_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    transports: Mapped[str | None] = mapped_column(String(255))

    # userVerification is always "required" in v1 (webauthn-prf.md §2, §7).
    uv_required: Mapped[bool] = mapped_column(nullable=False, default=True)

    # Unlock mechanism ranking actually available on this credential:
    # "prf" > "large_blob" > "uv_gated_local" (webauthn-prf.md §5).
    unlock_mechanism: Mapped[str] = mapped_column(String(32), nullable=False, default="prf")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    device: Mapped[Device] = relationship(back_populates="webauthn_credentials")


class DeviceKeyEnvelopeRow(Base):
    """Optional server mirror of the Device-Key Envelope (webauthn-prf.md §4).

    DK wrapped under DWK. Opaque to the server: without the WebAuthn PRF
    output (which never leaves the client) the DWK cannot be derived, so this
    blob is useless to a server-side attacker. Mirroring exists purely so a
    reinstalled client on the same device+authenticator can restore its local
    state.

    Not part of the snapshot model: the wrapped payload is DK, not VK, and it
    is rewritten in place when the credential re-wraps.
    """

    __tablename__ = "device_key_envelopes"
    __table_args__ = (
        UniqueConstraint(
            "vault_id", "device_id", "credential_id",
            name="uq_dke_vault_device_credential",
        ),
        CheckConstraint("octet_length(nonce) = 12", name="ck_dke_nonce_len"),
        CheckConstraint("octet_length(tag) = 16", name="ck_dke_tag_len"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    vault_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Raw WebAuthn credential id bytes: part of the envelope AAD
    # ("4allpass-device-key-v1" AAD binds vault, device, credential, version).
    credential_id: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    encryption: Mapped[str] = mapped_column(String(32), nullable=False, default="AES-256-GCM")
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    tag: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    device: Mapped[Device] = relationship(back_populates="device_key_envelopes")
