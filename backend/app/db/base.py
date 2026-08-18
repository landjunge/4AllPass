from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models.

    Import every model module here so Alembic autogenerate (env.py) sees
    the full metadata graph.
    """


# noqa imports: registers models on Base.metadata for Alembic autogenerate.
from app.models import (  # noqa: E402,F401
    device,
    device_key_envelope,
    entry,
    key_envelope,
    session,
    snapshot,
    user,
    vault,
    webauthn_credential,
)
