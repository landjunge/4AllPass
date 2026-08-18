"""Initial 4AllPass schema: accounts, vaults, snapshots, envelopes, devices.

Every blob column is opaque to the server. The CHECK constraints encode the
structural rules of Crypto Protocol v1 so a bug in the API layer still cannot
persist a malformed envelope: 12-byte nonces, 16-byte tags, 32-byte wrapped
keys, KDF parameters only on master envelopes, deviceId only on device
envelopes, and one envelope per (snapshot, type, device).

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

snapshot_status = sa.Enum("pending", "committed", name="snapshot_status")
envelope_type = sa.Enum("master", "device", "recovery", name="envelope_type")
unlock_mechanism = sa.Enum("prf", "large_blob", "uv_gated_local", name="unlock_mechanism")


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_accounts")),
        sa.UniqueConstraint("email", name=op.f("uq_accounts_email")),
    )
    op.create_table(
        "account_identities",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("account_id", sa.UUID(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name=op.f("fk_account_identities_account_id_accounts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_account_identities")),
        sa.UniqueConstraint(
            "provider", "subject", name=op.f("uq_account_identities_provider_subject")
        ),
    )
    op.create_table(
        "vaults",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("account_id", sa.UUID(), nullable=False),
        sa.Column("crypto_protocol_version", sa.Integer(), nullable=False),
        sa.Column("active_revision", sa.Integer(), nullable=True),
        sa.Column("active_vault_key_version", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(active_revision IS NULL) = (active_vault_key_version IS NULL)",
            name=op.f("ck_vaults_active_pointer_consistent"),
        ),
        sa.CheckConstraint(
            "active_revision IS NULL OR active_revision >= 1",
            name=op.f("ck_vaults_active_revision_positive"),
        ),
        sa.CheckConstraint(
            "crypto_protocol_version = 1", name=op.f("ck_vaults_crypto_protocol_version_v1")
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name=op.f("fk_vaults_account_id_accounts"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vaults")),
    )
    op.create_index(op.f("ix_vaults_account_id"), "vaults", ["account_id"], unique=False)
    op.create_table(
        "devices",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("vault_id", sa.String(length=64), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("platform", sa.String(length=64), nullable=True),
        sa.Column("user_agent_summary", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["vault_id"], ["vaults.id"], name=op.f("fk_devices_vault_id_vaults"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_devices")),
        sa.UniqueConstraint("vault_id", "device_id", name=op.f("uq_devices_vault_id_device_id")),
    )
    op.create_table(
        "vault_snapshots",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("vault_id", sa.String(length=64), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("vault_key_version", sa.Integer(), nullable=False),
        sa.Column("crypto_protocol_version", sa.Integer(), nullable=False),
        sa.Column("status", snapshot_status, nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("committed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(status = 'committed') = (committed_at IS NOT NULL)",
            name=op.f("ck_vault_snapshots_committed_at_matches_status"),
        ),
        sa.CheckConstraint(
            "crypto_protocol_version = 1",
            name=op.f("ck_vault_snapshots_crypto_protocol_version_v1"),
        ),
        sa.CheckConstraint("revision >= 1", name=op.f("ck_vault_snapshots_revision_positive")),
        sa.CheckConstraint(
            "vault_key_version >= 1", name=op.f("ck_vault_snapshots_vault_key_version_positive")
        ),
        sa.ForeignKeyConstraint(
            ["vault_id"],
            ["vaults.id"],
            name=op.f("fk_vault_snapshots_vault_id_vaults"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vault_snapshots")),
        sa.UniqueConstraint(
            "vault_id", "revision", name=op.f("uq_vault_snapshots_vault_id_revision")
        ),
    )
    op.create_index("ix_vault_snapshots_vault_id_status", "vault_snapshots", ["vault_id", "status"])
    op.create_table(
        "encrypted_entries",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("snapshot_id", sa.UUID(), nullable=False),
        sa.Column("entry_id", sa.String(length=128), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("crypto_version", sa.Integer(), nullable=False),
        sa.Column("vault_key_version", sa.Integer(), nullable=False),
        sa.Column("nonce", postgresql.BYTEA(), nullable=False),
        sa.Column("ciphertext", postgresql.BYTEA(), nullable=False),
        sa.Column("tag", postgresql.BYTEA(), nullable=False),
        sa.CheckConstraint(
            "crypto_version = 1", name=op.f("ck_encrypted_entries_crypto_version_v1")
        ),
        sa.CheckConstraint(
            "vault_key_version >= 1",
            name=op.f("ck_encrypted_entries_entry_vault_key_version_positive"),
        ),
        sa.CheckConstraint(
            "octet_length(ciphertext) >= 1", name=op.f("ck_encrypted_entries_ciphertext_not_empty")
        ),
        sa.CheckConstraint(
            "octet_length(nonce) = 12", name=op.f("ck_encrypted_entries_nonce_length")
        ),
        sa.CheckConstraint("octet_length(tag) = 16", name=op.f("ck_encrypted_entries_tag_length")),
        sa.CheckConstraint(
            "schema_version >= 1", name=op.f("ck_encrypted_entries_schema_version_positive")
        ),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["vault_snapshots.id"],
            name=op.f("fk_encrypted_entries_snapshot_id_vault_snapshots"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_encrypted_entries")),
        sa.UniqueConstraint(
            "snapshot_id", "entry_id", name=op.f("uq_encrypted_entries_snapshot_id_entry_id")
        ),
    )
    op.create_table(
        "key_envelopes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("snapshot_id", sa.UUID(), nullable=False),
        sa.Column("type", envelope_type, nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=True),
        sa.Column("vault_key_version", sa.Integer(), nullable=False),
        sa.Column("device_key_version", sa.Integer(), nullable=True),
        sa.Column("crypto_version", sa.Integer(), nullable=False),
        sa.Column("nonce", postgresql.BYTEA(), nullable=False),
        sa.Column("ciphertext", postgresql.BYTEA(), nullable=False),
        sa.Column("tag", postgresql.BYTEA(), nullable=False),
        sa.Column("kdf_algorithm", sa.String(length=32), nullable=True),
        sa.Column("kdf_version", sa.Integer(), nullable=True),
        sa.Column("kdf_memory_kib", sa.Integer(), nullable=True),
        sa.Column("kdf_iterations", sa.Integer(), nullable=True),
        sa.Column("kdf_parallelism", sa.Integer(), nullable=True),
        sa.Column("kdf_hash_len", sa.Integer(), nullable=True),
        sa.Column("kdf_salt", postgresql.BYTEA(), nullable=True),
        sa.CheckConstraint(
            "(type = 'device') = (device_id IS NOT NULL)",
            name=op.f("ck_key_envelopes_device_id_only_on_device_envelope"),
        ),
        sa.CheckConstraint(
            "vault_key_version >= 1",
            name=op.f("ck_key_envelopes_envelope_vault_key_version_positive"),
        ),
        sa.CheckConstraint(
            "(type = 'device') = (device_key_version IS NOT NULL)",
            name=op.f("ck_key_envelopes_device_key_version_only_on_device_envelope"),
        ),
        sa.CheckConstraint(
            "device_key_version IS NULL OR device_key_version >= 1",
            name=op.f("ck_key_envelopes_device_key_version_positive"),
        ),
        sa.CheckConstraint(
            "(type = 'master') = (kdf_algorithm IS NOT NULL)",
            name=op.f("ck_key_envelopes_kdf_only_on_master_envelope"),
        ),
        sa.CheckConstraint(
            "kdf_algorithm IS NULL OR (kdf_algorithm = 'argon2id' AND kdf_version = 19 AND "
            "kdf_hash_len = 32 AND kdf_iterations >= 1 AND kdf_parallelism >= 1 AND "
            "octet_length(kdf_salt) BETWEEN 16 AND 32)",
            name=op.f("ck_key_envelopes_kdf_parameters_valid"),
        ),
        sa.CheckConstraint("crypto_version = 1", name=op.f("ck_key_envelopes_crypto_version_v1")),
        sa.CheckConstraint(
            "octet_length(ciphertext) = 32", name=op.f("ck_key_envelopes_ciphertext_is_wrapped_key")
        ),
        sa.CheckConstraint("octet_length(nonce) = 12", name=op.f("ck_key_envelopes_nonce_length")),
        sa.CheckConstraint("octet_length(tag) = 16", name=op.f("ck_key_envelopes_tag_length")),
        sa.ForeignKeyConstraint(
            ["snapshot_id"],
            ["vault_snapshots.id"],
            name=op.f("fk_key_envelopes_snapshot_id_vault_snapshots"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_key_envelopes")),
        sa.UniqueConstraint(
            "snapshot_id",
            "type",
            "device_id",
            name=op.f("uq_key_envelopes_snapshot_id_type_device_id"),
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_table(
        "webauthn_credentials",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("device_pk", sa.UUID(), nullable=False),
        sa.Column("credential_id", postgresql.BYTEA(), nullable=False),
        sa.Column("rp_id", sa.String(length=255), nullable=False),
        sa.Column("mechanism", unlock_mechanism, nullable=False),
        sa.Column("user_verification_required", sa.Boolean(), nullable=False),
        sa.Column("prf_supported", sa.Boolean(), nullable=False),
        sa.Column("large_blob_supported", sa.Boolean(), nullable=False),
        sa.Column("transports", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "octet_length(credential_id) BETWEEN 1 AND 1023",
            name=op.f("ck_webauthn_credentials_credential_id_length"),
        ),
        sa.CheckConstraint(
            "user_verification_required",
            name=op.f("ck_webauthn_credentials_user_verification_required"),
        ),
        sa.ForeignKeyConstraint(
            ["device_pk"],
            ["devices.id"],
            name=op.f("fk_webauthn_credentials_device_pk_devices"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_webauthn_credentials")),
        sa.UniqueConstraint(
            "rp_id", "credential_id", name=op.f("uq_webauthn_credentials_rp_id_credential_id")
        ),
    )
    op.create_index(
        op.f("ix_webauthn_credentials_device_pk"),
        "webauthn_credentials",
        ["device_pk"],
        unique=False,
    )
    op.create_table(
        "device_key_envelopes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("credential_pk", sa.UUID(), nullable=False),
        sa.Column("vault_id", sa.String(length=64), nullable=False),
        sa.Column("device_id", sa.String(length=128), nullable=False),
        sa.Column("device_key_version", sa.Integer(), nullable=False),
        sa.Column("crypto_version", sa.Integer(), nullable=False),
        sa.Column("nonce", postgresql.BYTEA(), nullable=False),
        sa.Column("ciphertext", postgresql.BYTEA(), nullable=False),
        sa.Column("tag", postgresql.BYTEA(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "crypto_version = 1", name=op.f("ck_device_key_envelopes_crypto_version_v1")
        ),
        sa.CheckConstraint(
            "device_key_version >= 1",
            name=op.f("ck_device_key_envelopes_device_key_version_positive"),
        ),
        sa.CheckConstraint(
            "octet_length(ciphertext) = 32",
            name=op.f("ck_device_key_envelopes_ciphertext_is_wrapped_key"),
        ),
        sa.CheckConstraint(
            "octet_length(nonce) = 12", name=op.f("ck_device_key_envelopes_nonce_length")
        ),
        sa.CheckConstraint(
            "octet_length(tag) = 16", name=op.f("ck_device_key_envelopes_tag_length")
        ),
        sa.ForeignKeyConstraint(
            ["credential_pk"],
            ["webauthn_credentials.id"],
            name=op.f("fk_device_key_envelopes_credential_pk_webauthn_credentials"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["vault_id"],
            ["vaults.id"],
            name=op.f("fk_device_key_envelopes_vault_id_vaults"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_device_key_envelopes")),
        sa.UniqueConstraint("credential_pk", name=op.f("uq_device_key_envelopes_credential_pk")),
    )


def downgrade() -> None:
    op.drop_table("device_key_envelopes")
    op.drop_index(op.f("ix_webauthn_credentials_device_pk"), table_name="webauthn_credentials")
    op.drop_table("webauthn_credentials")
    op.drop_table("key_envelopes")
    op.drop_table("encrypted_entries")
    op.drop_index("ix_vault_snapshots_vault_id_status", table_name="vault_snapshots")
    op.drop_table("vault_snapshots")
    op.drop_table("devices")
    op.drop_index(op.f("ix_vaults_account_id"), table_name="vaults")
    op.drop_table("vaults")
    op.drop_table("account_identities")
    op.drop_table("accounts")
    bind = op.get_bind()
    unlock_mechanism.drop(bind, checkfirst=True)
    envelope_type.drop(bind, checkfirst=True)
    snapshot_status.drop(bind, checkfirst=True)
