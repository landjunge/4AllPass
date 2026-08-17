"""Devices, WebAuthn credentials, and mirrored Device-Key Envelopes.

Access to a vault is granted by the *existence of a device envelope* in the
active snapshot, not by a flag here (architecture.md §4). These rows are
metadata plus one opaque blob the server cannot open.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Enum,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import BYTEA, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import (
    CREDENTIAL_ID_MAX_BYTES,
    CRYPTO_PROTOCOL_VERSION,
    KEY_BYTES,
    NONCE_BYTES,
    TAG_BYTES,
    Base,
    created_at,
    nullable_timestamp,
    uuid_pk,
)


class UnlockMechanism(enum.StrEnum):
    """Fallback ranks of webauthn-prf.md §5, best first."""

    prf = "prf"
    large_blob = "large_blob"
    uv_gated_local = "uv_gated_local"


unlock_mechanism_enum = Enum(
    UnlockMechanism, name="unlock_mechanism", values_callable=lambda e: [m.value for m in e]
)


class Device(Base):
    """A browser profile or mobile device with its own stable identity."""

    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("vault_id", "device_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    vault_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False
    )
    #: The `device_id` bound into the device envelope AAD.
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    label: Mapped[str] = mapped_column(String(128), nullable=False)
    platform: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: Coarse summary only, e.g. "Chrome on macOS". Not the raw header.
    user_agent_summary: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = created_at()
    last_seen_at: Mapped[datetime | None] = nullable_timestamp()
    #: Soft revocation marker. The envelope still has to be dropped by a commit.
    revoked_at: Mapped[datetime | None] = nullable_timestamp()

    vault: Mapped["Vault"] = relationship(back_populates="devices")  # noqa: F821
    credentials: Mapped[list["WebAuthnCredential"]] = relationship(
        back_populates="device", cascade="all, delete-orphan", lazy="selectin"
    )


class WebAuthnCredential(Base):
    __tablename__ = "webauthn_credentials"
    __table_args__ = (
        UniqueConstraint("rp_id", "credential_id"),
        CheckConstraint(
            f"octet_length(credential_id) BETWEEN 1 AND {CREDENTIAL_ID_MAX_BYTES}",
            name="credential_id_length",
        ),
        # userVerification is always "required" for 4AllPass (webauthn-prf.md §7).
        CheckConstraint("user_verification_required", name="user_verification_required"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    device_pk: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    credential_id: Mapped[bytes] = mapped_column(BYTEA, nullable=False)
    rp_id: Mapped[str] = mapped_column(String(255), nullable=False)
    mechanism: Mapped[UnlockMechanism] = mapped_column(unlock_mechanism_enum, nullable=False)
    user_verification_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    prf_supported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    large_blob_supported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    transports: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = created_at()
    last_used_at: Mapped[datetime | None] = nullable_timestamp()
    revoked_at: Mapped[datetime | None] = nullable_timestamp()

    device: Mapped[Device] = relationship(back_populates="credentials")
    device_key_envelope: Mapped["DeviceKeyEnvelope | None"] = relationship(
        back_populates="credential", cascade="all, delete-orphan", uselist=False, lazy="selectin"
    )


class DeviceKeyEnvelope(Base):
    """Opaque mirror of the local Device-Key Envelope (webauthn-prf.md §2.1).

    The Device Key inside is wrapped under the Device Wrapping Key, which only a
    live PRF assertion on that authenticator can produce. Mirroring is therefore
    safe and is only accepted for the `prf` mechanism: ranks 2 and 3 are wrapped
    under a locally held key and must never be uploaded.
    """

    __tablename__ = "device_key_envelopes"
    __table_args__ = (
        UniqueConstraint("credential_pk"),
        CheckConstraint(f"crypto_version = {CRYPTO_PROTOCOL_VERSION}", name="crypto_version_v1"),
        CheckConstraint(f"octet_length(nonce) = {NONCE_BYTES}", name="nonce_length"),
        CheckConstraint(
            f"octet_length(ciphertext) = {KEY_BYTES}", name="ciphertext_is_wrapped_key"
        ),
        CheckConstraint(f"octet_length(tag) = {TAG_BYTES}", name="tag_length"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    credential_pk: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("webauthn_credentials.id", ondelete="CASCADE"),
        nullable=False,
    )
    vault_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False
    )
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    crypto_version: Mapped[int] = mapped_column(Integer, nullable=False)
    nonce: Mapped[bytes] = mapped_column(BYTEA, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(BYTEA, nullable=False)
    tag: Mapped[bytes] = mapped_column(BYTEA, nullable=False)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime | None] = nullable_timestamp()

    credential: Mapped[WebAuthnCredential] = relationship(back_populates="device_key_envelope")
