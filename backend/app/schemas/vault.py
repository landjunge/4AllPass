import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class VaultCreate(BaseModel):
    """Server-side metadata only; cryptographic material is client-owned."""

    model_config = ConfigDict(extra="forbid")

    crypto_protocol_version: int = Field(default=1, ge=1)


class VaultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    crypto_protocol_version: int
    created_at: datetime
