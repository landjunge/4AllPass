import base64
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from app.schemas.vault import _decode_b64


class DeviceRegisterRequest(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=255)]
    user_agent_summary: str | None = None


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vault_id: uuid.UUID
    name: str
    user_agent_summary: str | None
    created_at: datetime
    revoked_at: datetime | None


class WebAuthnCredentialIn(BaseModel):
    credential_id: bytes
    public_key_cose: bytes | None = None
    rp_id: Annotated[str, Field(min_length=1, max_length=255)]
    transports: str | None = None
    unlock_mechanism: Literal["prf", "large_blob", "uv_gated_local"] = "prf"

    @field_validator("credential_id", "public_key_cose", mode="before")
    @classmethod
    def _b64(cls, v: object) -> bytes | None:
        if v is None:
            return None
        return _decode_b64(v)


class WebAuthnCredentialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    credential_id: bytes
    rp_id: str
    sign_count: int
    uv_required: bool
    unlock_mechanism: str

    @field_serializer("credential_id", when_used="json")
    def _ser_credential_id(self, value: bytes) -> str:
        return base64.b64encode(value).decode("ascii")


class DeviceKeyEnvelopeIn(BaseModel):
    """Opaque mirror of the local Device-Key Envelope (webauthn-prf.md §4)."""

    version: Literal[1] = 1
    credential_id: bytes
    encryption: Literal["AES-256-GCM"] = "AES-256-GCM"
    nonce: bytes
    ciphertext: bytes
    tag: bytes

    @field_validator("credential_id", "nonce", "ciphertext", "tag", mode="before")
    @classmethod
    def _b64(cls, v: object) -> bytes:
        return _decode_b64(v)

    @field_validator("nonce")
    @classmethod
    def _nonce_len(cls, v: bytes) -> bytes:
        if len(v) != 12:
            raise ValueError("nonce must be 12 bytes")
        return v

    @field_validator("tag")
    @classmethod
    def _tag_len(cls, v: bytes) -> bytes:
        if len(v) != 16:
            raise ValueError("tag must be 16 bytes")
        return v


class DeviceKeyEnvelopeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    version: int
    vault_id: uuid.UUID
    device_id: uuid.UUID
    credential_id: bytes
    encryption: str
    nonce: bytes
    ciphertext: bytes
    tag: bytes

    @field_serializer("credential_id", "nonce", "ciphertext", "tag", when_used="json")
    def _ser_bytes(self, value: bytes) -> str:
        return base64.b64encode(value).decode("ascii")


class WebAuthnChallengeOut(BaseModel):
    challenge_id: uuid.UUID
    challenge: str  # base64
    rp_id: str
    user_verification: Literal["required"] = "required"
    expires_in_seconds: int
