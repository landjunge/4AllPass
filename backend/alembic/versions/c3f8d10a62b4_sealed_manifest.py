"""optional opaque sealed snapshot manifest

Revision ID: c3f8d10a62b4
Revises: b7c2a91e4f10
Create Date: 2026-08-18 04:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "c3f8d10a62b4"
down_revision: Union[str, None] = "b7c2a91e4f10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "vault_snapshots",
        sa.Column("sealed_manifest", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("vault_snapshots", "sealed_manifest")
