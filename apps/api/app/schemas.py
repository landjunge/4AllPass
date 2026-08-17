from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.zk import ENVELOPE_TYPES, FORBIDDEN_WIRE_KEYS, UNLOCK_MECHANISMS


def _reject_forbidden(data: dict[str, Any], label: str) -> dict[str, Any]:
    leaked = FORBIDDEN_WIRE_KEYS.intersection(data)
    if leaked:
        raise ValueError(f"{label} must not contain {sorted(leaked)}")
    return data


class KeyEnvelopeWire(BaseModel):
    """Opaque Device / Master / Recovery envelope. Server cannot unwrap it."""

    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    type: Literal["master", "device", "recovery"]
    kdf: dict[str, Any] | None = None
    deviceId: str | None = None
    encryption: Literal["AES-256-GCM"]
    nonce: str
    ciphertext: str
    tag: str

    @model_validator(mode="before")
    @classmethod
    def no_key_material(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return _reject_forbidden(data, "KeyEnvelope")
        return data

    @model_validator(mode="after")
    def type_fields(self) -> Self:
        if self.type == "device":
            if not self.deviceId:
                raise ValueError("device envelope requires deviceId")
            if self.kdf is not None:
                raise ValueError("device envelope must not carry kdf")
        if self.type != "device" and self.deviceId:
            raise ValueError(f"{self.type} envelope must not carry deviceId")
        if self.type == "master" and self.kdf is None:
            raise ValueError("master envelope requires kdf")
        if self.type == "recovery" and self.kdf is not None:
            raise ValueError("recovery envelope must not carry kdf")
        return self


class DeviceKeyEnvelopeWire(BaseModel):
    """Opaque Device-Key Envelope (DK under DWK). Optional server-side mirror."""

    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    vaultId: str
    deviceId: str
    credentialId: str
    encryption: Literal["AES-256-GCM"]
    nonce: str
    ciphertext: str
    tag: str

    @model_validator(mode="before")
    @classmethod
    def no_key_material(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return _reject_forbidden(data, "DeviceKeyEnvelope")
        return data


class EncryptedEntryWire(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    schemaVersion: int = Field(ge=1)
    cryptoVersion: int = Field(ge=1)
    nonce: str
    ciphertext: str
    tag: str

    @model_validator(mode="before")
    @classmethod
    def no_key_material(cls, data: Any) -> Any:
        if isinstance(data, dict):
            return _reject_forbidden(data, "EncryptedEntry")
        return data


class WebAuthnCredentialIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    credentialId: str
    rpId: str
    deviceId: str
    unlockMechanism: Literal["prf", "large_blob", "uv_gated_local"]
    userVerification: Literal["required"] = "required"
    deviceKeyEnvelope: DeviceKeyEnvelopeWire | None = None

    @field_validator("unlockMechanism")
    @classmethod
    def known_mechanism(cls, value: str) -> str:
        if value not in UNLOCK_MECHANISMS:
            raise ValueError("unsupported unlock mechanism")
        return value


assert set(ENVELOPE_TYPES) == {"master", "device", "recovery"}
