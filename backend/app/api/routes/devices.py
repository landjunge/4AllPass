"""Device metadata endpoints, gated by the full authorization chain:

    authenticated user (session cookie)
        -> owns vault            (get_owned_vault: 404 hides foreign vaults)
        -> device belongs to vault (query is scoped to the resolved vault)

Responses expose only ``DeviceOut`` — device metadata plus *whether* a
Device-Key Envelope mirror exists. Never DK, DWK, VK, PRF output, private
credential material, or envelope ciphertext (crypto-protocol.md §11,
docs/webauthn-prf.md §4).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, get_owned_vault
from app.models.device import Device
from app.models.device_key_envelope import DeviceKeyEnvelope
from app.models.vault import Vault
from app.schemas.device import DeviceOut

router = APIRouter(prefix="/vaults/{vault_id}/devices", tags=["devices"])

# Same shape for "no such device" and "device of another vault":
# device ids cannot be probed across vaults.
_DEVICE_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")


@router.get("", response_model=list[DeviceOut])
async def list_devices(
    vault: Vault = Depends(get_owned_vault), db: AsyncSession = Depends(get_db)
) -> list[DeviceOut]:
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
    vault: Vault = Depends(get_owned_vault),
    db: AsyncSession = Depends(get_db),
) -> DeviceOut:
    result = await db.execute(
        select(Device)
        .where(Device.vault_id == vault.id, Device.id == device_id)
        .options(selectinload(Device.webauthn_credentials))
    )
    device = result.scalar_one_or_none()
    if device is None:
        raise _DEVICE_NOT_FOUND

    envelope_result = await db.execute(
        select(DeviceKeyEnvelope.id).where(
            DeviceKeyEnvelope.vault_id == vault.id, DeviceKeyEnvelope.device_id == device_id
        )
    )
    payload = DeviceOut.model_validate(device)
    payload.has_device_key_envelope = envelope_result.scalar_one_or_none() is not None
    return payload
