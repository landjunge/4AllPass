from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Index, Integer, LargeBinary, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import EnvelopeType
from app.models.mixins import CreatedAtMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.snapshot import VaultSnapshot


class KeyEnvelope(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    """KeyEnvelope — crypto-protocol.md §3 ("KeyEnvelope Format (versioned)").

    Wraps the Vault Key under a Master Key, a Device Key, or a Recovery
    Key. The server only ever stores the opaque AEAD ciphertext plus the
    metadata needed to reconstruct the AAD (§3.1); it never sees the
    Vault Key, Master Key, Device Key, or Recovery Key.

    ``kdf_params`` mirrors ``KdfParams`` from ``packages/crypto`` and is
    only ever populated for ``type == "master"``; it carries the Argon2id
    salt and parameters so a client can always re-derive the Master Key,
    even after a profile upgrade (crypto-protocol.md §9).
    """

    __tablename__ = "key_envelopes"
    __table_args__ = (
        CheckConstraint(
            "(type = 'device' AND device_id IS NOT NULL) OR (type != 'device' AND device_id IS NULL)",
            name="ck_key_envelopes_device_id_requires_device_type",
        ),
        CheckConstraint(
            "(type = 'master' AND kdf_params IS NOT NULL) "
            "OR (type != 'master' AND kdf_params IS NULL)",
            name="ck_key_envelopes_kdf_params_requires_master_type",
        ),
        # At most one master / recovery envelope per snapshot.
        Index(
            "uq_key_envelopes_snapshot_singleton_type",
            "snapshot_id",
            "type",
            unique=True,
            postgresql_where=text("type IN ('master', 'recovery')"),
        ),
        # At most one envelope per (snapshot, device) for device envelopes.
        Index(
            "uq_key_envelopes_snapshot_device",
            "snapshot_id",
            "device_id",
            unique=True,
            postgresql_where=text("type = 'device'"),
        ),
    )

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("vault_snapshots.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Mapped[EnvelopeType] = mapped_column(
        Enum(
            EnvelopeType,
            name="envelope_type",
            native_enum=True,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
        ),
        nullable=False,
    )

    # Only for type == "device"; stable device/profile identifier, also part of the AAD.
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Only for type == "master"; Argon2id parameters (algorithm, version, memory,
    # iterations, parallelism, hashLen, salt-as-hex). Never a key or password.
    # `none_as_null=True`: a Python `None` must become a SQL NULL here, not a
    # stored JSON `null`, or `kdf_params IS NOT NULL` below would never fire.
    kdf_params: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )

    encryption: Mapped[str] = mapped_column(String(32), nullable=False, default="AES-256-GCM")
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    tag: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    crypto_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    snapshot: Mapped["VaultSnapshot"] = relationship(back_populates="envelopes")
