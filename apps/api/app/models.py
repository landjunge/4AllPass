"""SQLAlchemy schema.

Snapshots are the unit of vault storage (docs/vault-revision.md).
Device Envelopes live inside a snapshot as opaque JSON.
Device-Key Envelopes (DK under DWK) may be mirrored as an opaque blob on
the WebAuthn credential row. The server cannot unwrap either.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db import Base

# JSON on SQLite tests; JSONB on PostgreSQL.
OpaqueJson = JSON().with_variant(JSONB(), "postgresql")


def envelope_slot(envelope_type: str, device_id: str | None) -> str:
    if envelope_type == "device":
        if not device_id:
            raise ValueError("device envelope requires device_id")
        return f"device:{device_id}"
    if device_id:
        raise ValueError(f"{envelope_type} envelope must not carry device_id")
    return envelope_type


class Account(Base):
    """Account login only. Has zero influence on vault decryption."""

    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    # Account password hash (not the Master Password). Nullable when OAuth-only.
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    oauth_identities: Mapped[list[OAuthIdentity]] = relationship(back_populates="account")
    vaults: Mapped[list[Vault]] = relationship(back_populates="account")


class OAuthIdentity(Base):
    __tablename__ = "oauth_identities"
    __table_args__ = (UniqueConstraint("provider", "subject"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)

    account: Mapped[Account] = relationship(back_populates="oauth_identities")


class Vault(Base):
    __tablename__ = "vaults"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    crypto_protocol_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Clients fetch only the snapshot named by this pointer (CAS on write).
    active_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)

    account: Mapped[Account] = relationship(back_populates="vaults")
    snapshots: Mapped[list[VaultSnapshot]] = relationship(back_populates="vault")
    devices: Mapped[list[Device]] = relationship(back_populates="vault")


class VaultSnapshot(Base):
    """Immutable snapshot: envelopes + entries for one revision."""

    __tablename__ = "vault_snapshots"
    __table_args__ = (
        CheckConstraint("revision >= 1", name="ck_snapshot_revision"),
        CheckConstraint("vault_key_version >= 1", name="ck_snapshot_vault_key_version"),
    )

    vault_id: Mapped[str] = mapped_column(ForeignKey("vaults.id"), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_key_version: Mapped[int] = mapped_column(Integer, nullable=False)
    crypto_protocol_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    vault: Mapped[Vault] = relationship(back_populates="snapshots")
    envelopes: Mapped[list[SnapshotEnvelope]] = relationship(back_populates="snapshot")
    entries: Mapped[list[SnapshotEntry]] = relationship(back_populates="snapshot")


class SnapshotEnvelope(Base):
    """Master / Device / Recovery envelope as opaque wire JSON.

    For type=device this is the Device Envelope (VK wrapped under DK).
    The wrapping Device Key is never stored here.
    """

    __tablename__ = "snapshot_envelopes"
    __table_args__ = (
        ForeignKeyConstraint(
            ["vault_id", "revision"],
            ["vault_snapshots.vault_id", "vault_snapshots.revision"],
        ),
        CheckConstraint(
            "envelope_type IN ('master', 'device', 'recovery')",
            name="ck_envelope_type",
        ),
        CheckConstraint(
            "(envelope_type <> 'device' AND device_id IS NULL) OR "
            "(envelope_type = 'device' AND device_id IS NOT NULL)",
            name="ck_device_envelope_requires_device_id",
        ),
        CheckConstraint(
            "(envelope_type = 'device' AND envelope_slot = 'device:' || device_id) OR "
            "(envelope_type <> 'device' AND envelope_slot = envelope_type)",
            name="ck_envelope_slot",
        ),
    )

    vault_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    # "master" | "recovery" | "device:<device_id>" — avoids NULL-unique holes.
    envelope_slot: Mapped[str] = mapped_column(String(160), primary_key=True)
    envelope_type: Mapped[str] = mapped_column(String(16), nullable=False)
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    envelope: Mapped[dict[str, Any]] = mapped_column(OpaqueJson, nullable=False)

    snapshot: Mapped[VaultSnapshot] = relationship(back_populates="envelopes")


class SnapshotEntry(Base):
    """EncryptedEntry ciphertext. Server never sees plaintext."""

    __tablename__ = "snapshot_entries"
    __table_args__ = (
        ForeignKeyConstraint(
            ["vault_id", "revision"],
            ["vault_snapshots.vault_id", "vault_snapshots.revision"],
        ),
    )

    vault_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    entry_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    crypto_version: Mapped[int] = mapped_column(Integer, nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    tag: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    snapshot: Mapped[VaultSnapshot] = relationship(back_populates="entries")


class Device(Base):
    """Device / browser-profile metadata. Authorization is the Device Envelope."""

    __tablename__ = "devices"

    vault_id: Mapped[str] = mapped_column(ForeignKey("vaults.id"), primary_key=True)
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    user_agent_summary: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Metadata only. Soft revoke is absence of the Device Envelope from the active snapshot.
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    vault: Mapped[Vault] = relationship(back_populates="devices")
    webauthn_credential: Mapped[WebAuthnCredential | None] = relationship(back_populates="device")


class WebAuthnCredential(Base):
    """WebAuthn credential + optional opaque Device-Key Envelope.

    PRF output and DWK are never persisted. v1: one credential per device.
    """

    __tablename__ = "webauthn_credentials"
    __table_args__ = (
        ForeignKeyConstraint(
            ["vault_id", "device_id"],
            ["devices.vault_id", "devices.id"],
        ),
        UniqueConstraint("vault_id", "device_id", name="uq_webauthn_device"),
        CheckConstraint(
            "unlock_mechanism IN ('prf', 'large_blob', 'uv_gated_local')",
            name="ck_unlock_mechanism",
        ),
    )

    credential_id: Mapped[bytes] = mapped_column(LargeBinary, primary_key=True)
    vault_id: Mapped[str] = mapped_column(String(128), nullable=False)
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    rp_id: Mapped[str] = mapped_column(String(255), nullable=False)
    unlock_mechanism: Mapped[str] = mapped_column(String(32), nullable=False)
    user_verification: Mapped[str] = mapped_column(String(16), nullable=False, default="required")
    # Opaque Device-Key Envelope (DK wrapped under DWK). Optional server mirror.
    device_key_envelope: Mapped[dict[str, Any] | None] = mapped_column(OpaqueJson, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    device: Mapped[Device] = relationship(back_populates="webauthn_credential")
