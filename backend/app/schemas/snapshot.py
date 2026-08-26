from typing import Literal
from uuid import UUID

from pydantic import Field

from app.core.limits import (
    CIPHERTEXT_B64_MAX,
    ENVELOPES_MAX,
    ENTRIES_MAX,
    ID_CHARS_MAX,
    NONCE_B64_MAX,
    TAG_B64_MAX,
)
from app.schemas.common import CamelModel, WriteModel


class WireKdfParams(CamelModel):
    algorithm: Literal["argon2id"]
    version: int
    memory: int
    iterations: int
    parallelism: int
    hash_len: int
    salt: str = Field(max_length=64)


class WireKeyEnvelope(CamelModel):
    version: int
    type: Literal["master", "device", "recovery"]
    vault_key_version: int
    encryption: Literal["AES-256-GCM"]
    nonce: str = Field(max_length=NONCE_B64_MAX)
    ciphertext: str = Field(max_length=CIPHERTEXT_B64_MAX)
    tag: str = Field(max_length=TAG_B64_MAX)
    device_id: str | None = Field(default=None, max_length=ID_CHARS_MAX)
    device_key_version: int | None = None
    kdf: WireKdfParams | None = None


class WireEncryptedEntry(CamelModel):
    id: str = Field(max_length=ID_CHARS_MAX)
    schema_version: int
    crypto_version: int
    vault_key_version: int
    nonce: str = Field(max_length=NONCE_B64_MAX)
    ciphertext: str = Field(max_length=CIPHERTEXT_B64_MAX)
    tag: str = Field(max_length=TAG_B64_MAX)


class WireSealedManifest(WriteModel):
    """Opaque sealed snapshot manifest. The server stores these bytes as-is."""

    version: int
    encryption: Literal["AES-256-GCM"]
    nonce: str = Field(max_length=NONCE_B64_MAX)
    ciphertext: str = Field(max_length=CIPHERTEXT_B64_MAX)
    tag: str = Field(max_length=TAG_B64_MAX)


class WireVaultSnapshot(CamelModel):
    vault_id: UUID
    revision: int
    vault_key_version: int
    crypto_protocol_version: int
    envelopes: list[WireKeyEnvelope] = Field(max_length=ENVELOPES_MAX)
    entries: list[WireEncryptedEntry] = Field(max_length=ENTRIES_MAX)
    sealed_manifest: WireSealedManifest | None = None


class SnapshotCommit(WriteModel):
    expected_revision: int | None = None
    revision: int = Field(ge=1)
    vault_key_version: int = Field(ge=1)
    crypto_protocol_version: Literal[1]
    envelopes: list[WireKeyEnvelope] = Field(max_length=ENVELOPES_MAX)
    entries: list[WireEncryptedEntry] = Field(default_factory=list, max_length=ENTRIES_MAX)
    sealed_manifest: WireSealedManifest | None = None


class WireDeviceKeyEnvelope(WriteModel):
    version: int
    vault_id: UUID
    device_id: str = Field(max_length=ID_CHARS_MAX)
    credential_id: str = Field(max_length=ID_CHARS_MAX)
    device_key_version: int
    encryption: Literal["AES-256-GCM"]
    nonce: str = Field(max_length=NONCE_B64_MAX)
    ciphertext: str = Field(max_length=CIPHERTEXT_B64_MAX)
    tag: str = Field(max_length=TAG_B64_MAX)
