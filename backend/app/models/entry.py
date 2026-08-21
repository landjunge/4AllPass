from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.types import GUID
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.snapshot import VaultSnapshot


class EncryptedEntry(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """EncryptedEntry — crypto-protocol.md §8.

    Opaque AES-256-GCM ciphertext of one vault item under the Vault Key.
    ``schema_version`` / ``crypto_version`` are read from the row itself on
    decrypt, never guessed by the caller (crypto-protocol.md §8, §9).
    """

    __tablename__ = "encrypted_entries"
    __table_args__ = (
        UniqueConstraint("snapshot_id", "entry_id", name="uq_encrypted_entries_snapshot_entry"),
    )

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("vault_snapshots.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    entry_id: Mapped[str] = mapped_column(String(128), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    crypto_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    vault_key_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    tag: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    snapshot: Mapped["VaultSnapshot"] = relationship(back_populates="entries")
