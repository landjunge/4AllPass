from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, LargeBinary, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.device import Device


class WebAuthnCredential(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """A registered WebAuthn credential — docs/webauthn-prf.md §2.1.

    Stores only ceremony/ID material needed to *trigger* a PRF-gated
    unlock: the credential id, RP id, COSE public key (for assertion
    signature verification, not for decryption), and capability flags.
    This table never holds PRF output, the DWK, the DK, or the VK — the
    server is not an encryption oracle (webauthn-prf.md, top).

    ``user_verification`` is recorded for audit but the client must
    always request ``"required"`` (webauthn-prf.md §7).
    """

    __tablename__ = "webauthn_credentials"

    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rp_id: Mapped[str] = mapped_column(String(255), nullable=False)
    credential_id: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, unique=True, index=True)
    # COSE public key extracted from a verified fmt=none registration.
    # Null on client_asserted legacy rows. Never PRF material.
    public_key: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    sign_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    transports: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

    mechanism: Mapped[str | None] = mapped_column(String(32), nullable=True)
    prf_supported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    large_blob_supported: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    user_verification: Mapped[str] = mapped_column(String(16), nullable=False, default="required")

    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    device: Mapped["Device"] = relationship(back_populates="webauthn_credentials")
