from fastapi import APIRouter, status

from app.api.deps import SessionDep, VaultDep
from app.api.serializers import (
    credential_to_response,
    device_key_envelope_to_wire,
    device_to_response,
)
from app.errors import UnprocessableError
from app.schemas.api import (
    CredentialRegisterRequest,
    CredentialResponse,
    DeviceRegisterRequest,
    DeviceResponse,
)
from app.schemas.wire import DeviceKeyEnvelope as WireDeviceKeyEnvelope
from app.schemas.wire import decode_credential_id_path
from app.services import devices as device_service

router = APIRouter(prefix="/vaults/{vault_id}/devices", tags=["devices"])


def _credential_id_bytes(credential_id: str) -> bytes:
    decoded = decode_credential_id_path(credential_id)
    if decoded is None:
        raise UnprocessableError("credentialId in the path must be non-empty base64url")
    return decoded


@router.get("", response_model=list[DeviceResponse])
async def list_devices(vault: VaultDep, session: SessionDep) -> list[DeviceResponse]:
    """Devices with the fact that decides access: is there a device envelope?"""
    authorized = await device_service.device_ids_in_active_snapshot(session, vault)
    devices = await device_service.list_devices(session, vault)
    return [device_to_response(device, device.device_id in authorized) for device in devices]


@router.post("", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
async def register_device(
    payload: DeviceRegisterRequest, vault: VaultDep, session: SessionDep
) -> DeviceResponse:
    device = await device_service.register_device(session, vault, payload)
    authorized = await device_service.device_ids_in_active_snapshot(session, vault)
    return device_to_response(device, device.device_id in authorized)


@router.post(
    "/{device_id}/credentials",
    response_model=CredentialResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_credential(
    device_id: str,
    payload: CredentialRegisterRequest,
    vault: VaultDep,
    session: SessionDep,
) -> CredentialResponse:
    """WebAuthn credential metadata. No public key, no PRF material."""
    device = await device_service.get_device(session, vault, device_id)
    credential = await device_service.add_credential(session, device, payload)
    return credential_to_response(credential)


@router.put(
    "/{device_id}/credentials/{credential_id}/device-key-envelope",
    response_model=WireDeviceKeyEnvelope,
)
async def put_device_key_envelope(
    device_id: str,
    credential_id: str,
    payload: WireDeviceKeyEnvelope,
    vault: VaultDep,
    session: SessionDep,
) -> WireDeviceKeyEnvelope:
    """Mirror the opaque PRF Device-Key Envelope so a browser can recover it."""
    device = await device_service.get_device(session, vault, device_id)
    credential = await device_service.get_credential(
        session, device, _credential_id_bytes(credential_id)
    )
    mirror = await device_service.put_device_key_envelope(
        session, vault, device, credential, payload
    )
    return device_key_envelope_to_wire(mirror, credential)


@router.get(
    "/{device_id}/credentials/{credential_id}/device-key-envelope",
    response_model=WireDeviceKeyEnvelope,
)
async def get_device_key_envelope(
    device_id: str,
    credential_id: str,
    vault: VaultDep,
    session: SessionDep,
) -> WireDeviceKeyEnvelope:
    device = await device_service.get_device(session, vault, device_id)
    credential = await device_service.get_credential(
        session, device, _credential_id_bytes(credential_id)
    )
    mirror = await device_service.get_device_key_envelope(session, credential)
    return device_key_envelope_to_wire(mirror, credential)


@router.delete("/{device_id}", response_model=DeviceResponse)
async def revoke_device(device_id: str, vault: VaultDep, session: SessionDep) -> DeviceResponse:
    """Soft revocation. Removing the envelope still needs a new snapshot."""
    device = await device_service.get_device(session, vault, device_id)
    device = await device_service.revoke_device(session, vault, device)
    authorized = await device_service.device_ids_in_active_snapshot(session, vault)
    return device_to_response(device, device.device_id in authorized)
