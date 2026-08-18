"""canonical lowercase account e-mail

Revision ID: c3f18a7d5b92
Revises: b7c2a91e4f10
Create Date: 2026-08-18 04:10:00.000000

``users.email`` already carries a unique index, but that index is
case-sensitive: without this constraint ``Ada@example.com`` and
``ada@example.com`` are two separate accounts. A user who registered one and
signed in as the other would authenticate successfully and then find an empty
vault list, and an attacker could register the case-variant of someone else's
address.

``app.core.emails`` lower-cases every address at the API boundary. Pinning the
same invariant in the database is what lets the existing unique index be read
as a *case-insensitive* one, and keeps it true for any future code path that
writes to this table without going through the API.

Existing rows are folded first. That can collide if two case-variant accounts
already exist, in which case the unique index aborts the migration — the right
outcome, since merging two accounts is not a decision a migration may make.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "c3f18a7d5b92"
down_revision: Union[str, None] = "b7c2a91e4f10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE users SET email = lower(email) WHERE email <> lower(email)")
    op.create_check_constraint("ck_users_email_is_lowercase", "users", "email = lower(email)")


def downgrade() -> None:
    op.drop_constraint("ck_users_email_is_lowercase", "users", type_="check")
