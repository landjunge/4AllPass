"""WebAuthn ceremony challenges — not vault-key material.

Each navigator.credentials.create / .get must use a fresh server-issued
challenge (webauthn-prf.md §2.4). The server never sees PRF output.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api.deps import get_current_user, get_owned_vault
from app.core.challenges import ChallengeStore, get_challenge_store
from app.core.config import get_settings
from app.core.encoding import b64decode, b64encode
from app.core.sessions import SessionStore, get_session_store
from app.models.user import User
from app.models.vault import Vault
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


@router.post("/{challenge_id}/consume", status_code=status.HTTP_204_NO_CONTENT)
async def consume_challenge(
    challenge_id: UUID,
    payload: ConsumeChallengeRequest,
    vault: Annotated[Vault, Depends(get_owned_vault)],
    user: Annotated[User, Depends(get_current_user)],
    challenges: Annotated[ChallengeStore, Depends(get_challenge_store)],
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
