from datetime import datetime
from uuid import UUID

from app.schemas.common import CamelModel, StrictCamelModel


class VaultCreateRequest(StrictCamelModel):
    """No client-controlled fields. Ownership comes from the session."""


class VaultSummary(CamelModel):
    vault_id: UUID
    crypto_protocol_version: int
    active_revision: int | None
    active_vault_key_version: int | None
    created_at: datetime
