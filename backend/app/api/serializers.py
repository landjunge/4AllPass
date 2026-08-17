"""ORM rows → wire schemas. Bytes stay bytes; pydantic base64-encodes them."""

from app.models import Device, DeviceKeyEnvelope, Vault, VaultSnapshot, WebAuthnCredential
from app.models import EncryptedEntry as EntryRow
from app.models import KeyEnvelope as EnvelopeRow
from app.schemas.api import (
    CredentialResponse,
    DeviceResponse,
    SnapshotResponse,
    VaultResponse,
)
from app.schemas.wire import DeviceKeyEnvelope as WireDeviceKeyEnvelope
from app.schemas.wire import EncryptedEntry as WireEntry
from app.schemas.wire import KdfParams as WireKdf
from app.schemas.wire import KeyEnvelope as WireEnvelope
from app.schemas.wire import encode_base64


def envelope_to_wire(row: EnvelopeRow) -> WireEnvelope:
    kdf = None
    if row.kdf_algorithm is not None:
        kdf = WireKdf(
            algorithm="argon2id",
            version=row.kdf_version,
            memory=row.kdf_memory_kib,
            iterations=row.kdf_iterations,
            parallelism=row.kdf_parallelism,
            hash_len=row.kdf_hash_len,
            salt=row.kdf_salt,
        )
    return WireEnvelope(
        version=row.crypto_version,
        type=row.type.value,
        encryption="AES-256-GCM",
        nonce=row.nonce,
        ciphertext=row.ciphertext,
        tag=row.tag,
        device_id=row.device_id,
        kdf=kdf,
    )


def entry_to_wire(row: EntryRow) -> WireEntry:
    return WireEntry(
        id=row.entry_id,
        schema_version=row.schema_version,
        crypto_version=row.crypto_version,
        nonce=row.nonce,
        ciphertext=row.ciphertext,
        tag=row.tag,
    )


def snapshot_to_wire(snapshot: VaultSnapshot) -> SnapshotResponse:
    return SnapshotResponse(
        vault_id=snapshot.vault_id,
        revision=snapshot.revision,
        vault_key_version=snapshot.vault_key_version,
        crypto_protocol_version=snapshot.crypto_protocol_version,
        envelopes=[envelope_to_wire(row) for row in snapshot.envelopes],
        entries=[entry_to_wire(row) for row in snapshot.entries],
    )


def device_key_envelope_to_wire(
    row: DeviceKeyEnvelope, credential: WebAuthnCredential
) -> WireDeviceKeyEnvelope:
    return WireDeviceKeyEnvelope(
        version=row.crypto_version,
        vault_id=row.vault_id,
        device_id=row.device_id,
        credential_id=credential.credential_id,
        encryption="AES-256-GCM",
        nonce=row.nonce,
        ciphertext=row.ciphertext,
        tag=row.tag,
    )


def credential_to_response(credential: WebAuthnCredential) -> CredentialResponse:
    return CredentialResponse(
        id=str(credential.id),
        credential_id=encode_base64(credential.credential_id),
        rp_id=credential.rp_id,
        mechanism=credential.mechanism.value,
        prf_supported=credential.prf_supported,
        large_blob_supported=credential.large_blob_supported,
        user_verification_required=credential.user_verification_required,
        has_mirrored_device_key_envelope=credential.device_key_envelope is not None,
        created_at=credential.created_at,
        last_used_at=credential.last_used_at,
        revoked_at=credential.revoked_at,
    )


def device_to_response(device: Device, has_device_envelope: bool) -> DeviceResponse:
    return DeviceResponse(
        device_id=device.device_id,
        label=device.label,
        platform=device.platform,
        user_agent_summary=device.user_agent_summary,
        created_at=device.created_at,
        last_seen_at=device.last_seen_at,
        revoked_at=device.revoked_at,
        has_device_envelope=has_device_envelope,
        credentials=[credential_to_response(c) for c in device.credentials],
    )


def vault_to_response(vault: Vault) -> VaultResponse:
    return VaultResponse(
        vault_id=vault.id,
        crypto_protocol_version=vault.crypto_protocol_version,
        active_revision=vault.active_revision,
        active_vault_key_version=vault.active_vault_key_version,
        created_at=vault.created_at,
    )
