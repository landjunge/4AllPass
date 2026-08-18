"""Request and response bodies for the HTTP API."""

from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator
from pydantic.alias_generators import to_camel

from app.models.base import CRYPTO_PROTOCOL_VERSION
from app.schemas.wire import DeviceKeyEnvelope, EncryptedEntry, KeyEnvelope, WireModel


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, populate_by_name=True, extra="forbid", from_attributes=True
    )


class RegisterRequest(ApiModel):
    email: EmailStr
    #: Account password, unrelated to the master password.
    password: str = Field(min_length=12, max_length=256)


class LoginRequest(ApiModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class SessionResponse(ApiModel):
    token: str
    expires_in: int
    account_id: str
    email: str


class AccountResponse(ApiModel):
    id: str
    email: str
    created_at: datetime


class VaultResponse(ApiModel):
    vault_id: str
    crypto_protocol_version: int
    active_revision: int | None
    active_vault_key_version: int | None
    created_at: datetime


class SnapshotCommitRequest(WireModel):
    """A complete snapshot plus the revision it is expected to replace.

    The commit is a compare-and-set on `active_revision` (vault-revision.md §4),
    so two clients racing on the same base revision cannot interleave writes.
    """

    expected_revision: int | None = Field(default=None, ge=1)
    revision: int = Field(ge=1)
    vault_key_version: int = Field(ge=1)
    crypto_protocol_version: Literal[CRYPTO_PROTOCOL_VERSION] = CRYPTO_PROTOCOL_VERSION
    envelopes: list[KeyEnvelope] = Field(min_length=1)
    entries: list[EncryptedEntry] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_revision_and_envelopes(self) -> Self:
        base = self.expected_revision or 0
        if self.revision != base + 1:
            raise ValueError(
                f"revision must be {base + 1} when replacing revision {base or 'none'}"
            )

        masters = [e for e in self.envelopes if e.type == "master"]
        if len(masters) != 1:
            raise ValueError("a snapshot must contain exactly one master envelope")
        if len([e for e in self.envelopes if e.type == "recovery"]) > 1:
            raise ValueError("a snapshot must not contain more than one recovery envelope")

        device_ids = [e.device_id for e in self.envelopes if e.type == "device"]
        if len(set(device_ids)) != len(device_ids):
            raise ValueError("duplicate device envelope for one device")

        entry_ids = [entry.id for entry in self.entries]
        if len(set(entry_ids)) != len(entry_ids):
            raise ValueError("duplicate entry id in snapshot")

        # One VK generation per snapshot: mixed generations are exactly the
        # substitution pattern the client-side integrity pass rejects.
        for envelope in self.envelopes:
            if envelope.vault_key_version != self.vault_key_version:
                raise ValueError(
                    "every envelope must carry the snapshot's vaultKeyVersion"
                )
        for entry in self.entries:
            if entry.vault_key_version != self.vault_key_version:
                raise ValueError("every entry must carry the snapshot's vaultKeyVersion")
        return self


class SnapshotResponse(WireModel):
    vault_id: str
    revision: int
    vault_key_version: int
    crypto_protocol_version: int
    envelopes: list[KeyEnvelope]
    entries: list[EncryptedEntry]


class DeviceRegisterRequest(ApiModel):
    device_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")
    label: str = Field(min_length=1, max_length=128)
    platform: str | None = Field(default=None, max_length=64)
    user_agent_summary: str | None = Field(default=None, max_length=255)


class CredentialRegisterRequest(ApiModel):
    credential_id: str = Field(min_length=1, description="base64 raw credential id")
    rp_id: str = Field(min_length=1, max_length=255)
    mechanism: Literal["prf", "large_blob", "uv_gated_local"]
    prf_supported: bool = False
    large_blob_supported: bool = False
    transports: str | None = Field(default=None, max_length=128)


class CredentialResponse(ApiModel):
    id: str
    credential_id: str
    rp_id: str
    mechanism: str
    prf_supported: bool
    large_blob_supported: bool
    user_verification_required: bool
    has_mirrored_device_key_envelope: bool
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class DeviceResponse(ApiModel):
    device_id: str
    label: str
    platform: str | None
    user_agent_summary: str | None
    created_at: datetime
    last_seen_at: datetime | None
    revoked_at: datetime | None
    #: True when the active snapshot still carries a device envelope for it.
    has_device_envelope: bool
    credentials: list[CredentialResponse]


class ErrorResponse(BaseModel):
    detail: str


__all__ = [
    "AccountResponse",
    "ApiModel",
    "CredentialRegisterRequest",
    "CredentialResponse",
    "DeviceKeyEnvelope",
    "DeviceRegisterRequest",
    "DeviceResponse",
    "ErrorResponse",
    "LoginRequest",
    "RegisterRequest",
    "SessionResponse",
    "SnapshotCommitRequest",
    "SnapshotResponse",
    "VaultResponse",
]
