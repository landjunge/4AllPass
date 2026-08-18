from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import CamelModel, WriteModel


class CredentialSummary(CamelModel):
    id: UUID
    credential_id: str
    rp_id: str
    mechanism: Literal["prf", "large_blob", "uv_gated_local"] | None = None
    prf_supported: bool
    large_blob_supported: bool
    user_verification_required: bool
    has_mirrored_device_key_envelope: bool = False
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    # The server stores client-asserted ceremony metadata. It does not verify
    # WebAuthn assertions or PRF output (docs/security-boundary.md).
    server_verified: Literal[False] = False
    verification: Literal["client_asserted"] = "client_asserted"


class DeviceSummary(CamelModel):
    device_id: str
    label: str | None = None
    platform: str | None = None
    user_agent_summary: str | None = None
    created_at: datetime
    last_seen_at: datetime | None
    revoked_at: datetime | None
    has_device_envelope: bool = False
    # DELETE /devices sets revoked_at only. Cryptographic revoke is a later
    # snapshot without this device envelope (and hard rotation if needed).
    revocation: Literal["none", "metadata_only"] = "none"
    credentials: list[CredentialSummary] = []


class RegisterDeviceRequest(WriteModel):
    device_id: str = Field(min_length=1, max_length=128)
    label: str | None = Field(default=None, max_length=255)
    platform: str | None = Field(default=None, max_length=64)
    user_agent_summary: str | None = Field(default=None, max_length=512)


class RegisterCredentialRequest(WriteModel):
    credential_id: str
    rp_id: str
    mechanism: Literal["prf", "large_blob", "uv_gated_local"]
    prf_supported: bool
    large_blob_supported: bool
