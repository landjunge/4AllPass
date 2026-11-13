"""Server-side state for v2 signed writes (ADR-015 step 3, default off).

These rows are server bookkeeping only. They never contain Vault Key material,
plaintext, entry ciphertext or response bodies: a receipt stores the operation
identity, digests, and a minimal allowlisted result.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import GUID, OpaqueJSON
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin


class VaultWriteKey(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Public Ed25519 write key per vault-key generation (V2 §1, D6)."""

    __tablename__ = "vault_write_keys"
    __table_args__ = (UniqueConstraint("vault_id", "key_version", name="uq_vault_write_keys_vault_version"),)

    vault_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key_version: Mapped[int] = mapped_column(Integer, nullable=False)
    public_key: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WriteReceipt(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Permanent idempotency authority; unique per vault and operation.

    Field names follow the contract. ``result`` is the allowlisted ReplayReceipt
    result only; response bodies are never stored.
    """

    __tablename__ = "write_receipts"
    __table_args__ = (UniqueConstraint("vault_id", "operation_id", name="uq_write_receipts_vault_operation"),)

    vault_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False, index=True
    )
    operation_id: Mapped[uuid.UUID] = mapped_column(GUID, nullable=False, index=True)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(GUID, nullable=False)
    device_id: Mapped[str] = mapped_column(String(128), nullable=False)
    route: Mapped[str] = mapped_column(String(128), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(16), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    parent_id: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    request_digest: Mapped[bytes] = mapped_column(LargeBinary(32), nullable=False)
    response_digest: Mapped[bytes | None] = mapped_column(LargeBinary(32), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    outcome_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outcome_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    result: Mapped[dict[str, Any] | None] = mapped_column(OpaqueJSON, nullable=True)
    # Client-signed inputs of the original write, so an exact retry can be
    # recognized after the head has advanced (manifest digest is not stable).
    signed_context: Mapped[dict[str, Any] | None] = mapped_column(OpaqueJSON, nullable=True)


class WriteNonce(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Replay window marker. The permanent receipt is the idempotency authority."""

    __tablename__ = "write_nonces"
    __table_args__ = (
        UniqueConstraint("vault_id", "key_version", "nonce", name="uq_write_nonces_vault_key_nonce"),
    )

    vault_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False, index=True
    )
    key_version: Mapped[int] = mapped_column(Integer, nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary(16), nullable=False)


class WriteGrant(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """One-time creation grant for a brand-new v2 vault (V2 §2, D5)."""

    __tablename__ = "write_grants"
    __table_args__ = (UniqueConstraint("vault_id", name="uq_write_grants_vault"),)

    vault_id: Mapped[uuid.UUID] = mapped_column(
        GUID, ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False, default="initial-key")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
