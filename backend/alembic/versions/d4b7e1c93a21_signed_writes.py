"""signed writes: receipts, nonces, write keys, creation grants

Additive only. Existing v1 vaults keep working; v2 acceptance is gated by
FOURALLPASS_SIGNED_WRITES_ENABLED and by the vault's crypto_protocol_version.

Revision ID: d4b7e1c93a21
Revises: c3f8d10a62b4
"""

from __future__ import annotations

from typing import Union

import sqlalchemy as sa
from alembic import op

from app.db.types import OpaqueJSON

revision: str = "d4b7e1c93a21"
down_revision: Union[str, None] = "c3f8d10a62b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vault_write_keys",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("vault_id", sa.Uuid(), sa.ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key_version", sa.Integer(), nullable=False),
        sa.Column("public_key", sa.LargeBinary(32), nullable=False),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("vault_id", "key_version", name="uq_vault_write_keys_vault_version"),
    )
    op.create_index("ix_vault_write_keys_vault_id", "vault_write_keys", ["vault_id"])

    op.create_table(
        "write_receipts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("vault_id", sa.Uuid(), sa.ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("owner_user_id", sa.Uuid(), nullable=False),
        sa.Column("device_id", sa.String(128), nullable=False),
        sa.Column("route", sa.String(128), nullable=False),
        sa.Column("resource_type", sa.String(16), nullable=False),
        sa.Column("resource_id", sa.String(128), nullable=False),
        sa.Column("parent_id", sa.String(128), nullable=False),
        sa.Column("request_digest", sa.LargeBinary(32), nullable=False),
        sa.Column("response_digest", sa.LargeBinary(32), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("outcome_status", sa.Integer(), nullable=True),
        sa.Column("outcome_code", sa.String(64), nullable=True),
        sa.Column("result", OpaqueJSON, nullable=True),
        sa.Column("signed_context", OpaqueJSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("vault_id", "operation_id", name="uq_write_receipts_vault_operation"),
    )
    op.create_index("ix_write_receipts_vault_id", "write_receipts", ["vault_id"])
    op.create_index("ix_write_receipts_operation_id", "write_receipts", ["operation_id"])

    op.create_table(
        "write_nonces",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("vault_id", sa.Uuid(), sa.ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key_version", sa.Integer(), nullable=False),
        sa.Column("nonce", sa.LargeBinary(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("vault_id", "key_version", "nonce", name="uq_write_nonces_vault_key_nonce"),
    )
    op.create_index("ix_write_nonces_vault_id", "write_nonces", ["vault_id"])

    op.create_table(
        "write_grants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("vault_id", sa.Uuid(), sa.ForeignKey("vaults.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("purpose", sa.String(32), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("vault_id", name="uq_write_grants_vault"),
    )
    op.create_index("ix_write_grants_vault_id", "write_grants", ["vault_id"])


def downgrade() -> None:
    op.drop_table("write_grants")
    op.drop_table("write_nonces")
    op.drop_table("write_receipts")
    op.drop_table("vault_write_keys")
