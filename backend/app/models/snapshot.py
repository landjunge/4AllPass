from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, LargeBinary, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.entry import EncryptedEntry
    from app.models.key_envelope import KeyEnvelope
    from app.models.vault import Vault


class VaultSnapshot(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """Immutable snapshot — docs/vault-revision.md §2.

    A snapshot is the server's unit of storage and of sync: a fixed
    ``(revision, vault_key_version)`` pair together with the full set of
    envelopes and entries that existed at that point. Rows in this table
    are never updated in place; a new revision is always a new row
    (docs/vault-revision.md §4, "Never flip active_revision before every
    entry and every envelope of N+1 is durable.").
    """

    __tablename__ = "vault_snapshots"
    __table_args__ = (
        UniqueConstraint("vault_id", "revision", name="uq_vault_snapshots_vault_revision"),
    )

    vault_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    vault_key_version: Mapped[int] = mapped_column(Integer, nullable=False)
    crypto_protocol_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    manifest_encryption: Mapped[str | None] = mapped_column(String(32), nullable=True)
    manifest_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    manifest_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    manifest_tag: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    manifest_crypto_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    vault: Mapped["Vault"] = relationship(back_populates="snapshots", foreign_keys=[vault_id])
    envelopes: Mapped[list["KeyEnvelope"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan"
    )
    entries: Mapped[list["EncryptedEntry"]] = relationship(
        back_populates="snapshot", cascade="all, delete-orphan"
    )
