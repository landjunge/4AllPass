import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, require_vault_owner
from app.models.device import Device
from app.models.device_key_envelope import DeviceKeyEnvelope
from app.models.vault import Vault
from app.schemas.device import DeviceOut

router = APIRouter(prefix="/vaults/{vault_id}/devices", tags=["devices"])


@router.get("", response_model=list[DeviceOut])
async def list_devices(
    vault: Vault = Depends(require_vault_owner),
    db: AsyncSession = Depends(get_db),
) -> list[DeviceOut]:
    """List devices registered to the specified vault.

    Enforces that the caller is authenticated and owns the vault.
    Never exposes DK, DWK, VK, PRF output, or private credential material.
    """
    result = await db.execute(
        select(Device)
        .where(Device.vault_id == vault.id)
        .options(selectinload(Device.webauthn_credentials))
    )
    devices = list(result.scalars().all())

    envelope_result = await db.execute(
        select(DeviceKeyEnvelope.device_id).where(DeviceKeyEnvelope.vault_id == vault.id)
    )
    device_ids_with_envelope = set(envelope_result.scalars().all())

    out: list[DeviceOut] = []
    for device in devices:
        payload = DeviceOut.model_validate(device)
        payload.has_device_key_envelope = device.id in device_ids_with_envelope
        out.append(payload)
    return out


@router.get("/{device_id}", response_model=DeviceOut)
async def get_device(
    device_id: uuid.UUID,
    vault: Vault = Depends(require_vault_owner),
    db: AsyncSession = Depends(get_db),
) -> DeviceOut:
    """Get metadata for a specific device in an owned vault.

    Enforces that the caller is authenticated and owns the vault, and that the
    device belongs to the vault.
    """
    result = await db.execute(
        select(Device)
        .where(Device.vault_id == vault.id, Device.id == device_id)
        .options(selectinload(Device.webauthn_credentials))
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found",
        )

    envelope_result = await db.execute(
        select(DeviceKeyEnvelope.id).where(
            DeviceKeyEnvelope.vault_id == vault.id, DeviceKeyEnvelope.device_id == device_id
        )
    )
    payload = DeviceOut.model_validate(device)
    payload.has_device_key_envelope = envelope_result.scalar_one_or_none() is not None
    return payload
