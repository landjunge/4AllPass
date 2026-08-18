from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, LargeBinary, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import CreatedUpdatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.device import Device
    from app.models.vault import Vault
    from app.models.webauthn_credential import WebAuthnCredential


class DeviceKeyEnvelope(UUIDPrimaryKeyMixin, CreatedUpdatedAtMixin, Base):
    """Opaque server-side mirror of the local Device-Key Envelope.

    docs/webauthn-prf.md §1 & §4:

        wrapDeviceKey(DK, DWK) -> Device-Key Envelope   (stored locally;
        MAY be mirrored to the server as an opaque blob)

    This is **not** the "Device Envelope" from crypto-protocol.md §3
    (that one wraps the Vault Key under the Device Key and lives in
    ``key_envelopes`` with ``type = "device"``). This table wraps the
    Device Key itself under the ephemeral Device Wrapping Key derived
    from the WebAuthn PRF output via HKDF-SHA-256:

        AAD = encodeAad([
          "4allpass-device-key-v1", vault_id, device_id, credential_id,
          crypto_version_u32be,
        ])
        ciphertext || tag = AES-256-GCM(DWK, DK, AAD)

    The server can never derive the DWK (it never sees the PRF output),
    so it can never decrypt this blob — mirroring it here only lets a
    user recover the same client-side convenience unlock from a second
    browser/session on an already-trusted device, without weakening
    Zero-Knowledge. WebAuthn is not an encryption oracle for the Vault
    Key (docs/webauthn-prf.md, top); mirroring this envelope does not
    change that, because unwrapping it still requires a fresh PRF-derived
    DWK that only the authenticator + this RP + this vault can produce.

    Exactly one row per ``(vault_id, device_id)``: v1 binds one Device Key
    to one device at a time (docs/webauthn-prf.md §1, "Device Key (DK) ...
    generated after first master-password unlock on this device").
    """

    __tablename__ = "device_key_envelopes"
    __table_args__ = (
        UniqueConstraint(
            "vault_id", "device_id", name="uq_device_key_envelopes_vault_device"
        ),
    )

    vault_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    webauthn_credential_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("webauthn_credentials.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Denormalized copy of webauthn_credentials.credential_id: part of the
    # envelope's own AAD, so it must be reconstructable without a join.
    credential_id: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    encryption: Mapped[str] = mapped_column(String(32), nullable=False, default="AES-256-GCM")
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    tag: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    crypto_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    device_key_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    vault: Mapped["Vault"] = relationship()
    device: Mapped["Device"] = relationship(back_populates="device_key_envelopes")
    webauthn_credential: Mapped["WebAuthnCredential"] = relationship()
