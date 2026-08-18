import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
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
    vault_id: uuid.UUID,
    _vault: Annotated[Vault, Depends(require_vault_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[Device]:
    result = await db.execute(
        select(Device)
        .where(Device.vault_id == vault_id)
        .options(selectinload(Device.webauthn_credentials))
    )
    devices = list(result.scalars().all())

    envelope_result = await db.execute(
        select(DeviceKeyEnvelope.device_id).where(DeviceKeyEnvelope.vault_id == vault_id)
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
    vault_id: uuid.UUID,
    device_id: uuid.UUID,
    _vault: Annotated[Vault, Depends(require_vault_owner)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DeviceOut:
    result = await db.execute(
        select(Device)
        .where(Device.vault_id == vault_id, Device.id == device_id)
        .options(selectinload(Device.webauthn_credentials))
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise HTTPException(status_code=404, detail="device not found")

    envelope_result = await db.execute(
        select(DeviceKeyEnvelope.id).where(
            DeviceKeyEnvelope.vault_id == vault_id, DeviceKeyEnvelope.device_id == device_id
        )
    )
    payload = DeviceOut.model_validate(device)
    payload.has_device_key_envelope = envelope_result.scalar_one_or_none() is not None
    return payload
