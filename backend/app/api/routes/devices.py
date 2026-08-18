"""Device metadata for one vault.

Reaching a device now takes three decisions, in this order:

    authenticated account  →  owns this vault  →  device belongs to this vault

``Depends(get_owned_vault)`` settles the first two before the handler body runs,
so there is no path on which device rows are loaded for a vault the caller does
not own. The third is expressed in the query itself: ``device_id`` is only ever
matched together with the authorized ``vault.id``, so a device id borrowed from
another vault selects nothing.

What comes back is metadata only. The Device Key, the Device Wrapping Key, the
Vault Key, the PRF output and the WebAuthn public key never appear in a
response — the first four because the server has never held them, the last
because ``DeviceOut`` does not name it. The Device-Key Envelope is reported as
a boolean: whether one is on file, never its bytes.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, get_owned_vault
from app.models.device import Device
from app.models.device_key_envelope import DeviceKeyEnvelope
from app.models.vault import Vault
from app.schemas.device import DeviceOut

router = APIRouter(prefix="/vaults/{vault_id}/devices", tags=["devices"])


@router.get("", response_model=list[DeviceOut])
async def list_devices(
    vault: Vault = Depends(get_owned_vault), db: AsyncSession = Depends(get_db)
) -> list[DeviceOut]:
    result = await db.execute(
        select(Device)
        .where(Device.vault_id == vault.id)
        .options(selectinload(Device.webauthn_credentials))
        .order_by(Device.created_at)
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
        raise HTTPException(status_code=404, detail="device not found")

    envelope_result = await db.execute(
        select(DeviceKeyEnvelope.id).where(
            DeviceKeyEnvelope.vault_id == vault.id, DeviceKeyEnvelope.device_id == device_id
        )
    )
    payload = DeviceOut.model_validate(device)
    payload.has_device_key_envelope = envelope_result.scalar_one_or_none() is not None
    return payload
