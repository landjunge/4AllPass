"""Device identity, WebAuthn credential metadata, and the envelope mirror."""

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ConflictError, NotFoundError, UnprocessableError
from app.models import (
    Device,
    DeviceKeyEnvelope,
    KeyEnvelope,
    UnlockMechanism,
    Vault,
    VaultSnapshot,
    WebAuthnCredential,
)
from app.models.vault import EnvelopeType, SnapshotStatus
from app.schemas.api import CredentialRegisterRequest, DeviceRegisterRequest
from app.schemas.wire import DeviceKeyEnvelope as WireDeviceKeyEnvelope
from app.schemas.wire import decode_base64


async def list_devices(session: AsyncSession, vault: Vault) -> list[Device]:
    result = await session.scalars(
        select(Device).where(Device.vault_id == vault.id).order_by(Device.created_at)
    )
    return list(result)


async def get_device(session: AsyncSession, vault: Vault, device_id: str) -> Device:
    device = await session.scalar(
        select(Device).where(Device.vault_id == vault.id, Device.device_id == device_id)
    )
    if device is None:
        raise NotFoundError("device not found")
    return device


async def register_device(
    session: AsyncSession, vault: Vault, payload: DeviceRegisterRequest
) -> Device:
    device = await session.scalar(
        select(Device).where(Device.vault_id == vault.id, Device.device_id == payload.device_id)
    )
    if device is None:
        device = Device(vault_id=vault.id, device_id=payload.device_id, label=payload.label)
        session.add(device)
    elif device.revoked_at is not None:
        raise ConflictError("device is revoked; commit a new snapshot to re-authorize it")
    device.label = payload.label
    device.platform = payload.platform
    device.user_agent_summary = payload.user_agent_summary
    device.last_seen_at = datetime.now(UTC)
    await session.commit()
    # Re-select so the credential chain is eagerly loaded for the response.
    return await get_device(session, vault, device.device_id)


async def add_credential(
    session: AsyncSession, device: Device, payload: CredentialRegisterRequest
) -> WebAuthnCredential:
    if device.revoked_at is not None:
        raise ConflictError("device is revoked")
    credential_id = decode_base64(payload.credential_id)
    if not isinstance(credential_id, bytes) or not credential_id:
        raise UnprocessableError("credentialId must be non-empty base64")

    existing = await session.scalar(
        select(WebAuthnCredential).where(
            WebAuthnCredential.rp_id == payload.rp_id,
            WebAuthnCredential.credential_id == credential_id,
        )
    )
    if existing is not None and existing.device_pk != device.id:
        raise ConflictError("credential is already registered on another device")

    credential = existing or WebAuthnCredential(
        device_pk=device.id, credential_id=credential_id, rp_id=payload.rp_id
    )
    credential.mechanism = UnlockMechanism(payload.mechanism)
    credential.user_verification_required = True
    credential.prf_supported = payload.prf_supported
    credential.large_blob_supported = payload.large_blob_supported
    credential.transports = payload.transports
    credential.revoked_at = None
    if existing is None:
        session.add(credential)
    await session.commit()
    return await get_credential(session, device, credential_id)


async def get_credential(
    session: AsyncSession, device: Device, credential_id: bytes
) -> WebAuthnCredential:
    credential = await session.scalar(
        select(WebAuthnCredential).where(
            WebAuthnCredential.device_pk == device.id,
            WebAuthnCredential.credential_id == credential_id,
        )
    )
    if credential is None:
        raise NotFoundError("credential not found")
    return credential


async def put_device_key_envelope(
    session: AsyncSession,
    vault: Vault,
    device: Device,
    credential: WebAuthnCredential,
    payload: WireDeviceKeyEnvelope,
) -> DeviceKeyEnvelope:
    """Store the opaque PRF mirror (webauthn-prf.md §2.1 step 7).

    Only the `prf` mechanism may be mirrored: its Device-Key Envelope needs the
    DWK from a live assertion, so the server holding it changes nothing. Ranks 2
    and 3 are wrapped under a key that lives on the client, and uploading them
    would move that trust boundary for no benefit.
    """
    if credential.mechanism is not UnlockMechanism.prf:
        raise UnprocessableError(
            f"device-key envelopes are only mirrored for the prf mechanism, "
            f"credential uses {credential.mechanism.value}"
        )
    if payload.vault_id != vault.id or payload.device_id != device.device_id:
        raise UnprocessableError("device-key envelope does not belong to this vault and device")
    if payload.credential_id != credential.credential_id:
        raise UnprocessableError("device-key envelope credentialId does not match the credential")

    mirror = await session.scalar(
        select(DeviceKeyEnvelope).where(DeviceKeyEnvelope.credential_pk == credential.id)
    )
    if mirror is None:
        mirror = DeviceKeyEnvelope(
            credential_pk=credential.id,
            vault_id=vault.id,
            device_id=device.device_id,
            crypto_version=payload.version,
            nonce=payload.nonce,
            ciphertext=payload.ciphertext,
            tag=payload.tag,
        )
        session.add(mirror)
    else:
        mirror.crypto_version = payload.version
        mirror.nonce = payload.nonce
        mirror.ciphertext = payload.ciphertext
        mirror.tag = payload.tag
        mirror.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(mirror)
    return mirror


async def get_device_key_envelope(
    session: AsyncSession, credential: WebAuthnCredential
) -> DeviceKeyEnvelope:
    mirror = await session.scalar(
        select(DeviceKeyEnvelope).where(DeviceKeyEnvelope.credential_pk == credential.id)
    )
    if mirror is None:
        raise NotFoundError("no mirrored device-key envelope for this credential")
    return mirror


async def revoke_device(session: AsyncSession, vault: Vault, device: Device) -> Device:
    """Soft revocation (crypto-protocol.md §7).

    The device loses the ability to sync, but a device that already knows the
    Vault Key still knows it. Dropping its envelope needs a new snapshot, and a
    possibly compromised device needs a hard rotation.
    """
    if device.revoked_at is None:
        device.revoked_at = datetime.now(UTC)
    for credential in device.credentials:
        credential.revoked_at = credential.revoked_at or device.revoked_at
    await session.commit()
    return await get_device(session, vault, device.device_id)


async def device_ids_in_active_snapshot(session: AsyncSession, vault: Vault) -> set[str]:
    if vault.active_revision is None:
        return set()
    rows = await session.scalars(
        select(KeyEnvelope.device_id)
        .join(VaultSnapshot, VaultSnapshot.id == KeyEnvelope.snapshot_id)
        .where(
            VaultSnapshot.vault_id == vault.id,
            VaultSnapshot.revision == vault.active_revision,
            VaultSnapshot.status == SnapshotStatus.committed,
            KeyEnvelope.type == EnvelopeType.device,
        )
    )
    return {device_id for device_id in rows if device_id}
