from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import CreatedUpdatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.device import Device
    from app.models.snapshot import VaultSnapshot
    from app.models.user import User


class Vault(UUIDPrimaryKeyMixin, CreatedUpdatedAtMixin, Base):
    """Vault metadata (crypto-protocol.md §11: what the server may store).

    The vault itself only ever stores metadata and immutable snapshots.
    ``active_snapshot_id`` is the CAS pointer described in
    docs/vault-revision.md §2 ("active_revision"): clients only ever fetch
    the snapshot it points to, never an assembled mix of revisions.

    The FK to ``vault_snapshots`` is declared with ``use_alter=True``
    because snapshots themselves reference their owning vault — see
    docs/vault-revision.md §4 (commit protocol) for why the pointer flips
    only after the new snapshot is fully durable.
    """

    __tablename__ = "vaults"

    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    crypto_protocol_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    active_snapshot_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "vault_snapshots.id",
            use_alter=True,
            name="fk_vaults_active_snapshot_id",
            deferrable=True,
            initially="DEFERRED",
        ),
        nullable=True,
    )

    owner: Mapped["User"] = relationship(back_populates="vaults")
    snapshots: Mapped[list["VaultSnapshot"]] = relationship(
        back_populates="vault",
        cascade="all, delete-orphan",
        foreign_keys="VaultSnapshot.vault_id",
    )
    active_snapshot: Mapped["VaultSnapshot | None"] = relationship(
        foreign_keys=[active_snapshot_id],
        post_update=True,
    )
    devices: Mapped[list["Device"]] = relationship(back_populates="vault", cascade="all, delete-orphan")
