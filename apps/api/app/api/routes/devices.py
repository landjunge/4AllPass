import base64
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.redis import get_redis
from app.db.base import get_db
from app.db.models import Device, DeviceKeyEnvelopeRow, Vault, WebAuthnCredential
from app.schemas.device import (
    DeviceKeyEnvelopeIn,
    DeviceKeyEnvelopeOut,
    DeviceOut,
    DeviceRegisterRequest,
    WebAuthnChallengeOut,
    WebAuthnCredentialIn,
    WebAuthnCredentialOut,
)

router = APIRouter(prefix="/v1", tags=["devices"])


def _load_device(db: Session, device_id: uuid.UUID) -> Device:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "device not found")
    return device


@router.post(
    "/vaults/{vault_id}/devices",
    response_model=DeviceOut,
    status_code=status.HTTP_201_CREATED,
)
def register_device(
    vault_id: uuid.UUID,
    body: DeviceRegisterRequest,
    db: Session = Depends(get_db),
) -> Device:
    if db.get(Vault, vault_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vault not found")
    device = Device(
        vault_id=vault_id,
        name=body.name,
        user_agent_summary=body.user_agent_summary,
    )
    db.add(device)
    db.commit()
    return device


@router.get("/vaults/{vault_id}/devices", response_model=list[DeviceOut])
def list_devices(vault_id: uuid.UUID, db: Session = Depends(get_db)) -> list[Device]:
    if db.get(Vault, vault_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vault not found")
    return list(db.scalars(select(Device).where(Device.vault_id == vault_id)))


@router.put(
    "/devices/{device_id}/webauthn-credential",
    response_model=WebAuthnCredentialOut,
    status_code=status.HTTP_201_CREATED,
)
def upsert_webauthn_credential(
    device_id: uuid.UUID,
    body: WebAuthnCredentialIn,
    db: Session = Depends(get_db),
) -> WebAuthnCredential:
    """Store public credential metadata after registration.

    v1 scaffold: attestation verification is not performed yet; only public
    material is stored. userVerification is always "required"
    (docs/webauthn-prf.md §2, §7) and not configurable.
    """
    device = _load_device(db, device_id)
    existing = db.scalar(
        select(WebAuthnCredential).where(
            WebAuthnCredential.credential_id == body.credential_id
        )
    )
    if existing is not None and existing.device_id != device.id:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "credential already registered to another device"
        )
    if existing is None:
        existing = WebAuthnCredential(
            device_id=device.id,
            credential_id=body.credential_id,
            rp_id=body.rp_id,
        )
        db.add(existing)
    existing.public_key_cose = body.public_key_cose
    existing.rp_id = body.rp_id
    existing.transports = body.transports
    existing.unlock_mechanism = body.unlock_mechanism
    existing.uv_required = True
    db.commit()
    return existing


@router.put(
    "/devices/{device_id}/device-key-envelope",
    response_model=DeviceKeyEnvelopeOut,
    status_code=status.HTTP_201_CREATED,
)
def upsert_device_key_envelope(
    device_id: uuid.UUID,
    body: DeviceKeyEnvelopeIn,
    db: Session = Depends(get_db),
) -> DeviceKeyEnvelopeRow:
    """Mirror the local Device-Key Envelope as an opaque blob (webauthn-prf.md §2.1)."""
    device = _load_device(db, device_id)
    row = db.scalar(
        select(DeviceKeyEnvelopeRow).where(
            DeviceKeyEnvelopeRow.vault_id == device.vault_id,
            DeviceKeyEnvelopeRow.device_id == device.id,
            DeviceKeyEnvelopeRow.credential_id == body.credential_id,
        )
    )
    if row is None:
        row = DeviceKeyEnvelopeRow(
            vault_id=device.vault_id,
            device_id=device.id,
            credential_id=body.credential_id,
        )
        db.add(row)
    row.version = body.version
    row.encryption = body.encryption
    row.nonce = body.nonce
    row.ciphertext = body.ciphertext
    row.tag = body.tag
    db.commit()
    return row


@router.get(
    "/devices/{device_id}/device-key-envelope",
    response_model=DeviceKeyEnvelopeOut,
)
def get_device_key_envelope(
    device_id: uuid.UUID,
    credential_id: str,
    db: Session = Depends(get_db),
) -> DeviceKeyEnvelopeRow:
    device = _load_device(db, device_id)
    try:
        raw_credential_id = base64.b64decode(credential_id, validate=True)
    except Exception as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "credential_id must be base64"
        ) from exc
    row = db.scalar(
        select(DeviceKeyEnvelopeRow).where(
            DeviceKeyEnvelopeRow.device_id == device.id,
            DeviceKeyEnvelopeRow.credential_id == raw_credential_id,
        )
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "device-key envelope not found")
    return row


@router.post("/webauthn/challenges", response_model=WebAuthnChallengeOut)
def create_webauthn_challenge(redis: Redis = Depends(get_redis)) -> WebAuthnChallengeOut:
    """Issue a single-use challenge, stored in Redis with a TTL.

    The client uses it for navigator.credentials.create/get. Consuming and
    verifying the signed assertion is part of the auth flow built on top of
    this scaffold.
    """
    settings = get_settings()
    challenge_id = uuid.uuid4()
    challenge = secrets.token_bytes(32)
    redis.set(
        f"webauthn:challenge:{challenge_id}",
        challenge,
        ex=settings.webauthn_challenge_ttl_seconds,
    )
    return WebAuthnChallengeOut(
        challenge_id=challenge_id,
        challenge=base64.b64encode(challenge).decode("ascii"),
        rp_id=settings.rp_id,
        expires_in_seconds=settings.webauthn_challenge_ttl_seconds,
    )
