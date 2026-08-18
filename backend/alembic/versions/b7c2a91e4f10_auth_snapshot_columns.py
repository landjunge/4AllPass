"""auth snapshot columns and device metadata

Revision ID: b7c2a91e4f10
Revises: 4e9316ce2d07
Create Date: 2026-08-18 03:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b7c2a91e4f10"
down_revision: Union[str, None] = "4e9316ce2d07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("platform", sa.String(length=64), nullable=True))
    op.add_column(
        "key_envelopes",
        sa.Column("vault_key_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column("key_envelopes", sa.Column("device_key_version", sa.Integer(), nullable=True))
    op.add_column(
        "encrypted_entries",
        sa.Column("vault_key_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column("webauthn_credentials", "public_key", existing_type=sa.LargeBinary(), nullable=True)
    op.add_column("webauthn_credentials", sa.Column("mechanism", sa.String(length=32), nullable=True))
    op.add_column(
        "device_key_envelopes",
        sa.Column("device_key_version", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("device_key_envelopes", "device_key_version")
    op.drop_column("webauthn_credentials", "mechanism")
    op.alter_column("webauthn_credentials", "public_key", existing_type=sa.LargeBinary(), nullable=False)
    op.drop_column("encrypted_entries", "vault_key_version")
    op.drop_column("key_envelopes", "device_key_version")
    op.drop_column("key_envelopes", "vault_key_version")
    op.drop_column("devices", "platform")
