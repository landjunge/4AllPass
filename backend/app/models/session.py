from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, LargeBinary, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.user import User


class UserSession(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """A browser session for an account login — architecture.md §3.

    A session proves *who is calling*. It never proves anything about vault
    contents: holding a valid session gets an attacker exactly the encrypted
    blobs the account already owns, never the Vault Key (crypto-protocol.md,
    Hard Invariant #5 — the account layer has zero influence on decryption).

    ``token_hash`` is SHA-256 of the opaque bearer token that lives in the
    cookie; the token itself is never stored. A database dump therefore
    yields no usable session tokens, matching how the rest of the schema
    treats client secrets. SHA-256 is the right primitive here rather than a
    password hash: the token is 256 bits of CSPRNG output, so there is no
    guessable preimage to slow down.
    """

    __tablename__ = "user_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, unique=True, index=True)

    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user_agent_summary: Mapped[str | None] = mapped_column(String(512), nullable=True)

    user: Mapped["User"] = relationship(back_populates="sessions")
