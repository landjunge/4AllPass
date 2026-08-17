"""Initial accounts, snapshots, and device envelopes.

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_table(
        "oauth_identities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider", "subject"),
    )
    op.create_table(
        "vaults",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("crypto_protocol_version", sa.Integer(), nullable=False),
        sa.Column("active_revision", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "vault_snapshots",
        sa.Column("vault_id", sa.String(length=128), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("vault_key_version", sa.Integer(), nullable=False),
        sa.Column("crypto_protocol_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("revision >= 1", name="ck_snapshot_revision"),
        sa.CheckConstraint("vault_key_version >= 1", name="ck_snapshot_vault_key_version"),
        sa.ForeignKeyConstraint(["vault_id"], ["vaults.id"]),
        sa.PrimaryKeyConstraint("vault_id", "revision"),
    )
    op.create_table(
        "snapshot_envelopes",
        sa.Column("vault_id", sa.String(length=128), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("envelope_slot", sa.String(length=160), nullable=False),
        sa.Column("envelope_type", sa.String(length=16), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=True),
        sa.Column("envelope", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.CheckConstraint(
            "envelope_type IN ('master', 'device', 'recovery')",
            name="ck_envelope_type",
        ),
        sa.CheckConstraint(
            "(envelope_type <> 'device' AND device_id IS NULL) OR "
            "(envelope_type = 'device' AND device_id IS NOT NULL)",
            name="ck_device_envelope_requires_device_id",
        ),
        sa.CheckConstraint(
            "(envelope_type = 'device' AND envelope_slot = 'device:' || device_id) OR "
            "(envelope_type <> 'device' AND envelope_slot = envelope_type)",
            name="ck_envelope_slot",
        ),
        sa.ForeignKeyConstraint(
            ["vault_id", "revision"],
            ["vault_snapshots.vault_id", "vault_snapshots.revision"],
        ),
        sa.PrimaryKeyConstraint("vault_id", "revision", "envelope_slot"),
    )
    op.create_table(
        "snapshot_entries",
        sa.Column("vault_id", sa.String(length=128), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("entry_id", sa.String(length=128), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("crypto_version", sa.Integer(), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("tag", sa.LargeBinary(), nullable=False),
        sa.ForeignKeyConstraint(
            ["vault_id", "revision"],
            ["vault_snapshots.vault_id", "vault_snapshots.revision"],
        ),
        sa.PrimaryKeyConstraint("vault_id", "revision", "entry_id"),
    )
    op.create_table(
        "devices",
        sa.Column("vault_id", sa.String(length=128), nullable=False),
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("user_agent_summary", sa.String(length=255), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"]),
        sa.ForeignKeyConstraint(["vault_id"], ["vaults.id"]),
        sa.PrimaryKeyConstraint("vault_id", "id"),
    )
    op.create_table(
        "webauthn_credentials",
        sa.Column("credential_id", sa.LargeBinary(), nullable=False),
        sa.Column("vault_id", sa.String(length=128), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("rp_id", sa.String(length=255), nullable=False),
        sa.Column("unlock_mechanism", sa.String(length=32), nullable=False),
        sa.Column("user_verification", sa.String(length=16), nullable=False),
        sa.Column("device_key_envelope", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "unlock_mechanism IN ('prf', 'large_blob', 'uv_gated_local')",
            name="ck_unlock_mechanism",
        ),
        sa.ForeignKeyConstraint(
            ["vault_id", "device_id"],
            ["devices.vault_id", "devices.id"],
        ),
        sa.PrimaryKeyConstraint("credential_id"),
        sa.UniqueConstraint("vault_id", "device_id", name="uq_webauthn_device"),
    )


def downgrade() -> None:
    op.drop_table("webauthn_credentials")
    op.drop_table("devices")
    op.drop_table("snapshot_entries")
    op.drop_table("snapshot_envelopes")
    op.drop_table("vault_snapshots")
    op.drop_table("vaults")
    op.drop_table("oauth_identities")
    op.drop_table("accounts")
