from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, get_owned_vault, get_session_store
from app.api.rate_limit import enforce_write_rate_limit
from app.core.sessions import SessionStore
from app.core.encoding import b64decode, b64encode, b64url_decode
from app.models.device import Device
from app.models.device_key_envelope import DeviceKeyEnvelope
from app.models.enums import EnvelopeType
from app.models.key_envelope import KeyEnvelope
from app.models.snapshot import VaultSnapshot
from app.models.vault import Vault
from app.models.webauthn_credential import WebAuthnCredential
from app.schemas.device import (
    CredentialSummary,
    DeviceSummary,
    RegisterCredentialRequest,
    RegisterDeviceRequest,
)
from app.schemas.snapshot import WireDeviceKeyEnvelope
from app.services.snapshots import load_active_snapshot

router = APIRouter(prefix="/vaults/{vault_id}/devices", tags=["devices"])


async def _devices_for_vault(db: AsyncSession, vault: Vault) -> list[Device]:
    result = await db.execute(
        select(Device)
        .where(Device.vault_id == vault.id)
        .options(selectinload(Device.webauthn_credentials), selectinload(Device.device_key_envelopes))
        .order_by(Device.created_at.asc())
    )
    return list(result.scalars().all())


async def _device_envelope_ids(db: AsyncSession, vault: Vault) -> set[str]:
    snapshot = await load_active_snapshot(db, vault)
    if snapshot is None:
        return set()
    return {env.device_id for env in snapshot.envelopes if env.type == EnvelopeType.DEVICE and env.device_id}


def _credential_out(cred: WebAuthnCredential, mirrored_for: set) -> CredentialSummary:
    return CredentialSummary(
        id=cred.id,
        credential_id=b64encode(cred.credential_id),
        rp_id=cred.rp_id,
        mechanism=cred.mechanism,  # type: ignore[arg-type]
        prf_supported=cred.prf_supported,
        large_blob_supported=cred.large_blob_supported,
        user_verification_required=cred.user_verification == "required",
        has_mirrored_device_key_envelope=cred.id in mirrored_for,
        created_at=cred.created_at,
        last_used_at=cred.last_used_at,
        revoked_at=cred.revoked_at,
    )


def _device_out(device: Device, envelope_ids: set[str]) -> DeviceSummary:
    mirrored = {row.webauthn_credential_id for row in device.device_key_envelopes}
    return DeviceSummary(
        device_id=device.device_id,
        label=device.display_name,
        platform=device.platform,
        user_agent_summary=device.user_agent_summary,
        created_at=device.created_at,
        last_seen_at=device.last_seen_at,
        revoked_at=device.revoked_at,
        has_device_envelope=device.device_id in envelope_ids,
        revocation="metadata_only" if device.revoked_at is not None else "none",
        credentials=[_credential_out(cred, mirrored) for cred in device.webauthn_credentials],
    )


async def _get_device(db: AsyncSession, vault: Vault, device_id: str) -> Device:
    result = await db.execute(
        select(Device)
        .where(Device.vault_id == vault.id, Device.device_id == device_id)
        .options(selectinload(Device.webauthn_credentials), selectinload(Device.device_key_envelopes))
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
    return device


def _require_active_device(device: Device) -> None:
    """Metadata revoke is not cryptographic erase, but the server must not
    keep handing out or accepting unlock material for a revoked device row.
    """
    if device.revoked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="device is revoked",
        )


def _device_envelope_in_snapshot(
    snapshot: VaultSnapshot | None, device_public_id: str
) -> KeyEnvelope | None:
    if snapshot is None:
        return None
    for envelope in snapshot.envelopes:
        if envelope.type == EnvelopeType.DEVICE and envelope.device_id == device_public_id:
            return envelope
    return None


async def _require_mirror_snapshot(
    db: AsyncSession, vault: Vault, expected_revision: int
) -> VaultSnapshot:
    snapshot = await load_active_snapshot(db, vault)
    if snapshot is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="no active snapshot")
    if snapshot.revision != expected_revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="revision conflict",
        )
    return snapshot


@router.get("", response_model=list[DeviceSummary])
async def list_devices(
    vault: Annotated[Vault, Depends(get_owned_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[DeviceSummary]:
    envelope_ids = await _device_envelope_ids(db, vault)
    return [_device_out(device, envelope_ids) for device in await _devices_for_vault(db, vault)]


@router.post("", response_model=DeviceSummary)
async def register_device(
    payload: RegisterDeviceRequest,
    request: Request,
    vault: Annotated[Vault, Depends(get_owned_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> DeviceSummary:
    await enforce_write_rate_limit(store, request, "device")
    result = await db.execute(
        select(Device)
        .where(Device.vault_id == vault.id, Device.device_id == payload.device_id)
        .options(selectinload(Device.webauthn_credentials), selectinload(Device.device_key_envelopes))
    )
    device = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if device is None:
        device = Device(
            vault_id=vault.id,
            device_id=payload.device_id,
            display_name=payload.label,
            platform=payload.platform,
            user_agent_summary=payload.user_agent_summary,
            last_seen_at=now,
        )
        db.add(device)
        await db.flush()
        device = await _get_device(db, vault, payload.device_id)
    else:
        device.display_name = payload.label or device.display_name
        device.platform = payload.platform or device.platform
        device.user_agent_summary = payload.user_agent_summary or device.user_agent_summary
        device.last_seen_at = now
        # Re-enrolment of metadata only. This does not restore a device
        # envelope or rotate keys; cryptographic access still depends on
        # the active snapshot.
        device.revoked_at = None
        await db.flush()
    return _device_out(device, await _device_envelope_ids(db, vault))


@router.get("/{device_id}", response_model=DeviceSummary)
async def get_device(
    device_id: str,
    vault: Annotated[Vault, Depends(get_owned_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DeviceSummary:
    device = await _get_device(db, vault, device_id)
    return _device_out(device, await _device_envelope_ids(db, vault))


@router.delete("/{device_id}", response_model=DeviceSummary)
async def revoke_device(
    device_id: str,
    request: Request,
    vault: Annotated[Vault, Depends(get_owned_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> DeviceSummary:
    device = await _get_device(db, vault, device_id)
    device.revoked_at = datetime.now(timezone.utc)
    for cred in device.webauthn_credentials:
        if cred.revoked_at is None:
            cred.revoked_at = device.revoked_at
    await db.flush()
    authorization = request.headers.get("authorization")
    keep = (
        authorization.split(" ", 1)[1].strip()
        if authorization and authorization.lower().startswith("bearer ")
        else None
    )
    await store.revoke_device(vault.owner_user_id, device.device_id, keep_token=keep)
    return _device_out(device, await _device_envelope_ids(db, vault))


@router.post("/{device_id}/credentials", response_model=CredentialSummary)
async def register_credential(
    device_id: str,
    payload: RegisterCredentialRequest,
    request: Request,
    vault: Annotated[Vault, Depends(get_owned_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> CredentialSummary:
    await enforce_write_rate_limit(store, request, "credential")
    device = await _get_device(db, vault, device_id)
    _require_active_device(device)
    try:
        credential_id = b64decode(payload.credential_id, label="credentialId")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    existing = await db.execute(
        select(WebAuthnCredential).where(WebAuthnCredential.credential_id == credential_id)
    )
    cred = existing.scalar_one_or_none()
    if cred is None:
        cred = WebAuthnCredential(
            device_id=device.id,
            rp_id=payload.rp_id,
            credential_id=credential_id,
            mechanism=payload.mechanism,
            prf_supported=payload.prf_supported,
            large_blob_supported=payload.large_blob_supported,
            user_verification="required",
        )
        db.add(cred)
        await db.flush()
    else:
        if cred.device_id != device.id:
            raise HTTPException(status_code=409, detail="credential already bound to another device")
        cred.mechanism = payload.mechanism
        cred.prf_supported = payload.prf_supported
        cred.large_blob_supported = payload.large_blob_supported
        cred.revoked_at = None
        await db.flush()
    return _credential_out(cred, set())


@router.put("/{device_id}/credentials/{credential_id}/device-key-envelope", response_model=WireDeviceKeyEnvelope)
async def put_device_key_envelope(
    device_id: str,
    credential_id: str,
    payload: WireDeviceKeyEnvelope,
    vault: Annotated[Vault, Depends(get_owned_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
    expected_revision: Annotated[int, Query(alias="expectedRevision")],
) -> WireDeviceKeyEnvelope:
    device = await _get_device(db, vault, device_id)
    _require_active_device(device)
    raw_id = _decode_credential_path(credential_id)
    cred = next((c for c in device.webauthn_credentials if c.credential_id == raw_id), None)
    if cred is not None and cred.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="credential is revoked")
    if cred is None:
        raise HTTPException(status_code=404, detail="credential not found")
    if payload.device_id != device.device_id or payload.vault_id != vault.id:
        raise HTTPException(status_code=422, detail="envelope identity does not match path")
    snapshot = await _require_mirror_snapshot(db, vault, expected_revision)
    snapshot_envelope = _device_envelope_in_snapshot(snapshot, device.device_id)
    if snapshot_envelope is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="no device envelope in the active revision",
        )
    if snapshot_envelope.device_key_version != payload.device_key_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="device-key generation does not match the active snapshot",
        )

    existing = await db.execute(
        select(DeviceKeyEnvelope).where(
            DeviceKeyEnvelope.vault_id == vault.id, DeviceKeyEnvelope.device_id == device.id
        )
    )
    row = existing.scalar_one_or_none()
    try:
        nonce = b64decode(payload.nonce, label="nonce")
        ciphertext = b64decode(payload.ciphertext, label="ciphertext")
        tag = b64decode(payload.tag, label="tag")
        cred_bytes = b64decode(payload.credential_id, label="credentialId")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if cred_bytes != raw_id:
        raise HTTPException(status_code=422, detail="credentialId does not match path")

    if row is None:
        row = DeviceKeyEnvelope(
            vault_id=vault.id,
            device_id=device.id,
            webauthn_credential_id=cred.id,
            credential_id=raw_id,
            encryption=payload.encryption,
            nonce=nonce,
            ciphertext=ciphertext,
            tag=tag,
            crypto_version=payload.version,
            device_key_version=payload.device_key_version,
        )
        db.add(row)
    else:
        row.webauthn_credential_id = cred.id
        row.credential_id = raw_id
        row.encryption = payload.encryption
        row.nonce = nonce
        row.ciphertext = ciphertext
        row.tag = tag
        row.crypto_version = payload.version
        row.device_key_version = payload.device_key_version
    await db.flush()
    return payload


@router.get("/{device_id}/credentials/{credential_id}/device-key-envelope", response_model=WireDeviceKeyEnvelope)
async def get_device_key_envelope(
    device_id: str,
    credential_id: str,
    vault: Annotated[Vault, Depends(get_owned_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> WireDeviceKeyEnvelope:
    device = await _get_device(db, vault, device_id)
    _require_active_device(device)
    raw_id = _decode_credential_path(credential_id)
    snapshot = await load_active_snapshot(db, vault)
    snapshot_envelope = _device_envelope_in_snapshot(snapshot, device.device_id)
    if snapshot_envelope is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="device-key envelope not in the active revision",
        )
    result = await db.execute(
        select(DeviceKeyEnvelope).where(
            DeviceKeyEnvelope.vault_id == vault.id,
            DeviceKeyEnvelope.device_id == device.id,
            DeviceKeyEnvelope.credential_id == raw_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="device-key envelope not found")
    if snapshot_envelope.device_key_version != row.device_key_version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="stale device-key generation",
        )
    return WireDeviceKeyEnvelope(
        version=row.crypto_version,
        vault_id=vault.id,
        device_id=device.device_id,
        credential_id=b64encode(row.credential_id),
        device_key_version=row.device_key_version,
        encryption=row.encryption,  # type: ignore[arg-type]
        nonce=b64encode(row.nonce),
        ciphertext=b64encode(row.ciphertext),
        tag=b64encode(row.tag),
    )


def _decode_credential_path(value: str) -> bytes:
    try:
        return b64url_decode(value)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail="credential id is not valid base64url") from exc
