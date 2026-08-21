"""WebAuthn ceremony challenges — not vault-key material.

Each navigator.credentials.create / .get must use a fresh server-issued
challenge (webauthn-prf.md §2.4). The server never sees PRF output.
Consuming an assertion may verify a COSE signature; that is ceremony
integrity, not wrapping.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_db, get_owned_vault
from app.core.challenges import ChallengeStore, get_challenge_store
from app.core.config import get_settings
from app.core.encoding import b64decode, b64encode
from app.core.sessions import SessionStore, get_session_store
from app.core.webauthn_cose import CeremonyError, verify_assertion
from app.models.device import Device
from app.models.user import User
from app.models.vault import Vault
from app.models.webauthn_credential import WebAuthnCredential
from app.schemas.webauthn import ConsumeChallengeRequest, IssueChallengeRequest, IssuedChallengeOut

router = APIRouter(prefix="/vaults/{vault_id}/webauthn/challenges", tags=["webauthn"])


async def _rate_limit(store: SessionStore, user: User, vault: Vault) -> None:
    settings = get_settings()
    if await store.hit_rate_limit(
        f"webauthn:{user.id}:{vault.id}",
        settings.webauthn_challenge_rate_limit,
        settings.webauthn_challenge_rate_window_seconds,
    ):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too many ceremonies")


@router.post("", response_model=IssuedChallengeOut)
async def issue_challenge(
    payload: IssueChallengeRequest,
    vault: Annotated[Vault, Depends(get_owned_vault)],
    user: Annotated[User, Depends(get_current_user)],
    challenges: Annotated[ChallengeStore, Depends(get_challenge_store)],
    sessions: Annotated[SessionStore, Depends(get_session_store)],
) -> IssuedChallengeOut:
    await _rate_limit(sessions, user, vault)
    settings = get_settings()
    issued = await challenges.issue(
        user_id=user.id,
        vault_id=vault.id,
        purpose=payload.purpose,
        device_id=payload.device_id,
        ttl_seconds=settings.webauthn_challenge_ttl_seconds,
    )
    return IssuedChallengeOut(
        challenge_id=issued.challenge_id,
        challenge=b64encode(issued.challenge),
        expires_in=issued.expires_in,
        purpose=payload.purpose,
    )


def _assertion_fields(payload: ConsumeChallengeRequest) -> bool:
    present = [
        payload.credential_id is not None,
        payload.client_data_json is not None,
        payload.authenticator_data is not None,
        payload.signature is not None,
    ]
    if any(present) and not all(present):
        raise HTTPException(status_code=422, detail="incomplete WebAuthn assertion")
    return all(present)


@router.post("/{challenge_id}/consume", status_code=status.HTTP_204_NO_CONTENT)
async def consume_challenge(
    challenge_id: UUID,
    payload: ConsumeChallengeRequest,
    vault: Annotated[Vault, Depends(get_owned_vault)],
    user: Annotated[User, Depends(get_current_user)],
    challenges: Annotated[ChallengeStore, Depends(get_challenge_store)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    try:
        raw = b64decode(payload.challenge, label="challenge")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    record = await challenges.consume(
        challenge_id=challenge_id,
        user_id=user.id,
        vault_id=vault.id,
        purpose=payload.purpose,
        challenge=raw,
    )
    if record is None:
        # Missing, expired, already used, or binding mismatch — same 404.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="challenge not found")

    if not _assertion_fields(payload):
        return
    if payload.purpose != "assert":
        raise HTTPException(status_code=422, detail="assertion payload is only valid for purpose=assert")
    assert payload.credential_id is not None
    assert payload.client_data_json is not None
    assert payload.authenticator_data is not None
    assert payload.signature is not None
    try:
        credential_id = b64decode(payload.credential_id, label="credentialId")
        client_data = b64decode(payload.client_data_json, label="clientDataJSON")
        authenticator_data = b64decode(payload.authenticator_data, label="authenticatorData")
        signature = b64decode(payload.signature, label="signature")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    result = await db.execute(
        select(WebAuthnCredential)
        .join(Device, WebAuthnCredential.device_id == Device.id)
        .where(
            Device.vault_id == vault.id,
            WebAuthnCredential.credential_id == credential_id,
        )
        .options(selectinload(WebAuthnCredential.device))
    )
    cred = result.scalar_one_or_none()
    if (
        cred is None
        or cred.revoked_at is not None
        or cred.device.revoked_at is not None
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="credential not found")
    if cred.public_key is None:
        raise HTTPException(status_code=422, detail="credential has no COSE public key")
    try:
        verified = verify_assertion(
            credential_id=credential_id,
            client_data_json=client_data,
            authenticator_data=authenticator_data,
            signature=signature,
            public_key=cred.public_key,
            current_sign_count=int(cred.sign_count),
            expected_challenge=raw,
            expected_rp_id=cred.rp_id,
            settings=get_settings(),
        )
    except CeremonyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    cred.sign_count = verified.sign_count
    cred.last_used_at = datetime.now(timezone.utc)
    await db.flush()
