from datetime import datetime
from uuid import UUID

from app.schemas.common import CamelModel


class VaultCreateRequest(CamelModel):
    # v2 is opt-in and never upgrades an existing vault.
    crypto_protocol_version: int = 1
    account_password: str | None = None


class VaultSummary(CamelModel):
    vault_id: UUID
    crypto_protocol_version: int
    active_revision: int | None
    active_vault_key_version: int | None
    created_at: datetime
    # Returned exactly once for a new v2 vault; consumed by the first
    # signed device registration. Never exposed for a v1 vault.
    creation_grant: str | None = None
