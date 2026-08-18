"""Wire schemas for the opaque blobs the server accepts.

These mirror `packages/crypto/src/wire.ts` field for field. The server cannot
decrypt anything, so validation here is structural: exact byte lengths, the
protocol version, and which fields may appear on which envelope type. It also
refuses KDF profiles below the production floor, because a weak master envelope
would still be a real weakness after a server compromise.
"""

import base64
import binascii
from typing import Annotated, Literal, Self

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    PlainSerializer,
    model_validator,
)
from pydantic.alias_generators import to_camel

from app.models.base import (
    CREDENTIAL_ID_MAX_BYTES,
    CRYPTO_PROTOCOL_VERSION,
    KEY_BYTES,
    NONCE_BYTES,
    PRODUCTION_KDF_MEMORY_KIB_MIN,
    SALT_MAX_BYTES,
    SALT_MIN_BYTES,
    TAG_BYTES,
)


def decode_base64(value: object) -> object:
    if not isinstance(value, str):
        return value
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError(f"invalid base64: {error}") from error


def encode_base64(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def decode_credential_id_path(value: str) -> bytes | None:
    """Decode a credential id taken from a URL path.

    Raw credential ids are arbitrary bytes, so the path form is base64url
    without padding. Standard base64 is accepted too, because a client that
    already holds the JSON form should not have to re-encode it.
    """
    padded = value + "=" * (-len(value) % 4)
    for decoder in (base64.urlsafe_b64decode, base64.b64decode):
        try:
            decoded = decoder(padded)
        except (binascii.Error, ValueError):
            continue
        if decoded:
            return decoded
    return None


Base64Bytes = Annotated[
    bytes,
    BeforeValidator(decode_base64),
    PlainSerializer(encode_base64, return_type=str),
]

Nonce = Annotated[Base64Bytes, Field(min_length=NONCE_BYTES, max_length=NONCE_BYTES)]
Tag = Annotated[Base64Bytes, Field(min_length=TAG_BYTES, max_length=TAG_BYTES)]
WrappedKey = Annotated[Base64Bytes, Field(min_length=KEY_BYTES, max_length=KEY_BYTES)]
Salt = Annotated[Base64Bytes, Field(min_length=SALT_MIN_BYTES, max_length=SALT_MAX_BYTES)]
CredentialId = Annotated[Base64Bytes, Field(min_length=1, max_length=CREDENTIAL_ID_MAX_BYTES)]


class WireModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        ser_json_bytes="base64",
    )


class KdfParams(WireModel):
    algorithm: Literal["argon2id"]
    version: Literal[19]
    memory: int = Field(ge=8)
    iterations: int = Field(ge=1)
    parallelism: int = Field(ge=1)
    hash_len: Literal[32]
    salt: Salt

    @model_validator(mode="after")
    def reject_test_profile(self) -> Self:
        if self.memory < PRODUCTION_KDF_MEMORY_KIB_MIN:
            raise ValueError(
                f"Argon2id memory {self.memory} KiB is below the production floor of "
                f"{PRODUCTION_KDF_MEMORY_KIB_MIN} KiB; the ci profile must not be persisted"
            )
        return self


class KeyEnvelope(WireModel):
    version: Literal[CRYPTO_PROTOCOL_VERSION]
    type: Literal["master", "device", "recovery"]
    vault_key_version: int = Field(ge=1)
    encryption: Literal["AES-256-GCM"]
    nonce: Nonce
    ciphertext: WrappedKey
    tag: Tag
    device_id: str | None = Field(default=None, max_length=128)
    device_key_version: int | None = Field(default=None, ge=1)
    kdf: KdfParams | None = None

    @model_validator(mode="after")
    def check_type_fields(self) -> Self:
        if self.type == "master" and self.kdf is None:
            raise ValueError("master envelope requires kdf parameters")
        if self.type != "master" and self.kdf is not None:
            raise ValueError(f"{self.type} envelope must not carry kdf parameters")
        if self.type == "device" and not self.device_id:
            raise ValueError("device envelope requires deviceId")
        if self.type != "device" and self.device_id is not None:
            raise ValueError(f"{self.type} envelope must not carry deviceId")
        if self.type == "device" and self.device_key_version is None:
            raise ValueError("device envelope requires deviceKeyVersion")
        if self.type != "device" and self.device_key_version is not None:
            raise ValueError(f"{self.type} envelope must not carry deviceKeyVersion")
        return self


class EncryptedEntry(WireModel):
    id: str = Field(min_length=1, max_length=128)
    schema_version: int = Field(ge=1)
    crypto_version: Literal[CRYPTO_PROTOCOL_VERSION]
    vault_key_version: int = Field(ge=1)
    nonce: Nonce
    ciphertext: Annotated[Base64Bytes, Field(min_length=1)]
    tag: Tag


class DeviceKeyEnvelope(WireModel):
    """Opaque mirror of the PRF Device-Key Envelope."""

    version: Literal[CRYPTO_PROTOCOL_VERSION]
    vault_id: str = Field(min_length=1, max_length=64)
    device_id: str = Field(min_length=1, max_length=128)
    credential_id: CredentialId
    device_key_version: int = Field(ge=1)
    encryption: Literal["AES-256-GCM"]
    nonce: Nonce
    ciphertext: WrappedKey
    tag: Tag
