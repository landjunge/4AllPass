from typing import Literal
from uuid import UUID

from pydantic import Field

from app.schemas.common import CamelModel, RequestModel


class WireKdfParams(CamelModel):
    algorithm: Literal["argon2id"]
    version: int
    memory: int
    iterations: int
    parallelism: int
    hash_len: int
    salt: str


class WireKeyEnvelope(CamelModel):
    version: int
    type: Literal["master", "device", "recovery"]
    vault_key_version: int
    encryption: Literal["AES-256-GCM"]
    nonce: str
    ciphertext: str
    tag: str
    device_id: str | None = None
    device_key_version: int | None = None
    kdf: WireKdfParams | None = None


class WireEncryptedEntry(CamelModel):
    id: str
    schema_version: int
    crypto_version: int
    vault_key_version: int
    nonce: str
    ciphertext: str
    tag: str


class WireVaultSnapshot(CamelModel):
    vault_id: UUID
    revision: int
    vault_key_version: int
    crypto_protocol_version: int
    envelopes: list[WireKeyEnvelope]
    entries: list[WireEncryptedEntry]


class SnapshotCommit(RequestModel):
    expected_revision: int | None = None
    revision: int = Field(ge=1)
    vault_key_version: int = Field(ge=1)
    crypto_protocol_version: Literal[1]
    envelopes: list[WireKeyEnvelope]
    entries: list[WireEncryptedEntry] = []


class WireDeviceKeyEnvelope(CamelModel):
    version: int
    vault_id: UUID
    device_id: str
    credential_id: str
    device_key_version: int
    encryption: Literal["AES-256-GCM"]
    nonce: str
    ciphertext: str
    tag: str
