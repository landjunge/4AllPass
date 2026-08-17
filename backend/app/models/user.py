from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import CreatedUpdatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.vault import Vault


class User(UUIDPrimaryKeyMixin, CreatedUpdatedAtMixin, Base):
    """Account identity — separate from vault decryption (architecture.md §3).

    Only account-level auth material lives here (email, account password
    hash, optional OAuth identifiers). None of it can decrypt a vault:
    Social Login / OAuth / Account Password have zero influence on vault
    decryption (crypto-protocol.md, Hard Invariant #5).
    """

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    account_password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    oauth_provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    oauth_subject: Mapped[str | None] = mapped_column(String(255), nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    vaults: Mapped[list["Vault"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )
