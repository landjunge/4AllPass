"""Account authentication data.

The account password and any OAuth identity are for reaching the API only.
They have zero influence on vault decryption (crypto-protocol.md §1, §11).
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at, nullable_timestamp, uuid_pk


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    # Argon2id hash of the *account* password. Never the master password.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = created_at()
    last_login_at: Mapped[datetime | None] = nullable_timestamp()

    identities: Mapped[list["AccountIdentity"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )
    vaults: Mapped[list["Vault"]] = relationship(  # noqa: F821
        back_populates="account", cascade="all, delete-orphan"
    )


class AccountIdentity(Base):
    """Google / Apple sign-in. Comfort only: no vault key material is derived."""

    __tablename__ = "account_identities"
    __table_args__ = (UniqueConstraint("provider", "subject"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = created_at()

    account: Mapped[Account] = relationship(back_populates="identities")
