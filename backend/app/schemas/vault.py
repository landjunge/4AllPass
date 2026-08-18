import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class VaultCreate(BaseModel):
    """Request payload to initialize vault ownership on the server.

    NOTE: The server never generates or receives the Vault Key (VK).
    This only registers the vault metadata container for the authenticated user.
    """

    model_config = ConfigDict(extra="forbid")

    crypto_protocol_version: int = Field(default=1, ge=1)


class VaultOut(BaseModel):
    """Safe vault metadata response."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    crypto_protocol_version: int
    active_snapshot_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
