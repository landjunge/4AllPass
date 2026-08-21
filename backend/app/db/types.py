"""Portable column types.

Postgres stays UUID / JSONB so existing Alembic revisions do not drift.
SQLite (local app profile and default pytest) uses Uuid + JSON. The server
still stores opaque bytes; these types do not change the crypto boundary.
"""

from sqlalchemy import JSON, Uuid
from sqlalchemy.dialects.postgresql import JSONB

GUID = Uuid(as_uuid=True)
OpaqueJSON = JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql")
