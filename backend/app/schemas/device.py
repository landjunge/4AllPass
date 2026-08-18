from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import CamelModel


class CredentialSummary(CamelModel):
    id: UUID
    credential_id: str
    rp_id: str
    mechanism: Literal["prf", "large_blob", "uv_gated_local"] | None = None
    # Client-supplied capability claim. The server does not run a WebAuthn
    # ceremony, so this is never proof of PRF possession.
    prf_supported: bool
    large_blob_supported: bool
    user_verification_required: bool
    has_mirrored_device_key_envelope: bool = False
    # Always false until the server verifies an authenticator assertion.
    webauthn_possession_verified: bool = False
    prf_verified_by_server: bool = False
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class DeviceSummary(CamelModel):
    device_id: str
    label: str | None = None
    platform: str | None = None
    user_agent_summary: str | None = None
    created_at: datetime
    last_seen_at: datetime | None
    revoked_at: datetime | None
    # True iff the *active snapshot* still contains a device envelope for this
    # device. DELETE /devices only flips metadata; cryptographic soft-revoke
    # is the next snapshot without that envelope.
    has_device_envelope: bool = False
    # "none" | "metadata_only". Never "cryptographic" — that would over-claim.
    revocation_kind: Literal["none", "metadata_only"] = "none"
    credentials: list[CredentialSummary] = []


class RegisterDeviceRequest(CamelModel):
    device_id: str = Field(min_length=1, max_length=128)
    label: str | None = Field(default=None, max_length=255)
    platform: str | None = Field(default=None, max_length=64)
    user_agent_summary: str | None = Field(default=None, max_length=512)
    # Clearing revoked_at is an explicit owner action (re-enrolment), not a
    # side effect of posting the same deviceId again.
    reactivate: bool = False


class RegisterCredentialRequest(CamelModel):
    credential_id: str
    rp_id: str
    mechanism: Literal["prf", "large_blob", "uv_gated_local"]
    prf_supported: bool
    large_blob_supported: bool
