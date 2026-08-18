"""store sealed snapshot manifests

Revision ID: c91d8e42a6f3
Revises: b7c2a91e4f10
Create Date: 2026-08-18 04:30:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c91d8e42a6f3"
down_revision: Union[str, None] = "b7c2a91e4f10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("vault_snapshots", sa.Column("manifest_encryption", sa.String(length=32), nullable=True))
    op.add_column("vault_snapshots", sa.Column("manifest_nonce", sa.LargeBinary(), nullable=True))
    op.add_column("vault_snapshots", sa.Column("manifest_ciphertext", sa.LargeBinary(), nullable=True))
    op.add_column("vault_snapshots", sa.Column("manifest_tag", sa.LargeBinary(), nullable=True))
    op.add_column(
        "vault_snapshots",
        sa.Column("manifest_crypto_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.alter_column("vault_snapshots", "manifest_crypto_version", server_default=None)
    # Existing snapshots predate manifest integration and cannot be made
    # authentic by the server. They remain unreadable through the hardened API
    # until a trusted client replaces them with a newly sealed snapshot.


def downgrade() -> None:
    op.drop_column("vault_snapshots", "manifest_crypto_version")
    op.drop_column("vault_snapshots", "manifest_tag")
    op.drop_column("vault_snapshots", "manifest_ciphertext")
    op.drop_column("vault_snapshots", "manifest_nonce")
    op.drop_column("vault_snapshots", "manifest_encryption")
