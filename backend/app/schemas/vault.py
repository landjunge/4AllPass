"""Vault schemas — metadata only, never key material.

``VaultOut`` exposes exactly what crypto-protocol.md §11 allows the server
to store about a vault: identity, protocol version, and the active-snapshot
CAS pointer (docs/vault-revision.md §2). ``owner_user_id`` is intentionally
not exposed: the caller only ever sees vaults they own, so returning the
owner id would be redundant at best and an enumeration aid at worst.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class VaultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    crypto_protocol_version: int
    active_snapshot_id: uuid.UUID | None
    created_at: datetime
