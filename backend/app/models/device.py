from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.device_key_envelope import DeviceKeyEnvelope
    from app.models.vault import Vault
    from app.models.webauthn_credential import WebAuthnCredential


class Device(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Device / browser-profile identity — architecture.md §4, crypto-protocol.md §11.

    ``device_id`` is the stable string identifier that is bound into the
    Device Envelope AAD and the DWK HKDF `info` (docs/webauthn-prf.md §3–4).
    It is *not* the surrogate primary key: the AAD needs a caller-chosen
    stable string, independent of storage concerns.

    Revocation is cryptographic, not just a flag: soft revocation deletes
    this device's ``KeyEnvelope`` (type="device") from the next snapshot;
    ``revoked_at`` here is bookkeeping/audit only (architecture.md §4).
    """

    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("vault_id", "device_id", name="uq_devices_vault_device_id"),)

    vault_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    user_agent_summary: Mapped[str | None] = mapped_column(String(512), nullable=True)

    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    vault: Mapped["Vault"] = relationship(back_populates="devices")
    webauthn_credentials: Mapped[list["WebAuthnCredential"]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )
    device_key_envelopes: Mapped[list["DeviceKeyEnvelope"]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )
