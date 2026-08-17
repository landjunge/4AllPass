"""Wire schemas. All binary fields travel as standard base64 strings.

The server validates shape (lengths, required fields per envelope type) but
never interprets ciphertext.
"""

import base64
import uuid
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)


def _decode_b64(value: object) -> bytes:
    if isinstance(value, bytes):
        return value
    if isinstance(value, str):
        return base64.b64decode(value, validate=True)
    raise TypeError("expected base64 string")


class _B64Model(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    @field_serializer("*", when_used="json")
    def _serialize_bytes(self, value: object, _info):
        if isinstance(value, bytes):
            return base64.b64encode(value).decode("ascii")
        return value


class KdfParams(_B64Model):
    algorithm: Literal["argon2id"] = "argon2id"
    version: int = 0x13
    memory: Annotated[int, Field(ge=8)]
    iterations: Annotated[int, Field(ge=1)]
    parallelism: Annotated[int, Field(ge=1)]
    hash_len: Literal[32] = 32
    salt: bytes

    @field_validator("salt", mode="before")
    @classmethod
    def _salt_b64(cls, v: object) -> bytes:
        raw = _decode_b64(v)
        if len(raw) not in (16, 32):
            raise ValueError("salt must be 16 or 32 bytes")
        return raw


class GcmBoxFields(_B64Model):
    encryption: Literal["AES-256-GCM"] = "AES-256-GCM"
    nonce: bytes
    ciphertext: bytes
    tag: bytes

    @field_validator("nonce", mode="before")
    @classmethod
    def _nonce(cls, v: object) -> bytes:
        raw = _decode_b64(v)
        if len(raw) != 12:
            raise ValueError("nonce must be 12 bytes")
        return raw

    @field_validator("ciphertext", mode="before")
    @classmethod
    def _ciphertext(cls, v: object) -> bytes:
        raw = _decode_b64(v)
        if len(raw) == 0:
            raise ValueError("ciphertext must not be empty")
        return raw

    @field_validator("tag", mode="before")
    @classmethod
    def _tag(cls, v: object) -> bytes:
        raw = _decode_b64(v)
        if len(raw) != 16:
            raise ValueError("tag must be 16 bytes")
        return raw


class KeyEnvelopeIn(GcmBoxFields):
    version: Literal[1] = 1
    type: Literal["master", "device", "recovery"]
    kdf: KdfParams | None = None
    device_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _type_specific_fields(self) -> "KeyEnvelopeIn":
        if (self.type == "device") != (self.device_id is not None):
            raise ValueError("device_id is required for (and only for) device envelopes")
        if (self.type == "master") != (self.kdf is not None):
            raise ValueError("kdf is required for (and only for) master envelopes")
        return self


class KeyEnvelopeOut(KeyEnvelopeIn):
    pass


class EncryptedEntryIn(GcmBoxFields):
    id: Annotated[str, Field(min_length=1, max_length=255)]
    schema_version: Annotated[int, Field(ge=1)]
    crypto_version: Annotated[int, Field(ge=1)]


class EncryptedEntryOut(EncryptedEntryIn):
    pass


class SnapshotCommitRequest(BaseModel):
    """Commit protocol per docs/vault-revision.md §4.

    expected_active_revision is the revision the client last saw (None for the
    very first commit). The server writes the snapshot in full, then flips
    active_revision with a CAS on that expectation.
    """

    expected_active_revision: int | None = None
    revision: Annotated[int, Field(ge=1)]
    vault_key_version: Annotated[int, Field(ge=1)]
    crypto_protocol_version: Literal[1] = 1
    envelopes: Annotated[list[KeyEnvelopeIn], Field(min_length=1)]
    entries: list[EncryptedEntryIn] = []


class SnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    vault_id: uuid.UUID
    revision: int
    vault_key_version: int
    crypto_protocol_version: int
    envelopes: list[KeyEnvelopeOut]
    entries: list[EncryptedEntryOut]


class VaultCreateRequest(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=255)]
    user_email: Annotated[str, Field(min_length=3, max_length=320)]


class VaultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    crypto_protocol_version: int
    active_revision: int | None
