import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class WebAuthnCredentialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    rp_id: str
    prf_supported: bool
    large_blob_supported: bool
    user_verification: str
    last_used_at: datetime | None
    revoked_at: datetime | None


class DeviceOut(BaseModel):
    """Device summary — never includes key material.

    Only metadata the server is allowed to store (crypto-protocol.md §11):
    device id, display name, last seen, revocation status, and whether a
    Device-Key Envelope mirror / WebAuthn credential is on file.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: str
    display_name: str | None
    last_seen_at: datetime | None
    revoked_at: datetime | None
    webauthn_credentials: list[WebAuthnCredentialOut] = []
    has_device_key_envelope: bool = False
