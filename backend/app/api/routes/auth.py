from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    enforce_csrf,
    get_current_user,
    get_db,
    get_session_store,
    read_presented_credential,
)
from app.core.config import get_settings
from app.core.cookies import clear_session_cookies, set_session_cookies
from app.core.security import (
    hash_account_password,
    new_csrf_token,
    new_session_token,
    verify_account_password,
    verify_decoy_password,
)
from app.core.sessions import SessionStore, new_session_record
from app.models.user import User
from app.schemas.auth import AccountMe, AccountSession, LoginRequest, RegisterRequest

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_bucket(request: Request, action: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{action}:{ip}"


async def _rate_limit(store: SessionStore, request: Request, action: str) -> None:
    settings = get_settings()
    if await store.hit_rate_limit(
        _client_bucket(request, action),
        settings.auth_login_rate_limit,
        settings.auth_login_rate_window_seconds,
    ):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too many attempts"
        )


async def _start_session(
    store: SessionStore, response: Response, user: User, *, issue_bearer_token: bool
) -> AccountSession:
    """Mint a brand-new session and attach it to the response.

    Always a fresh token, never a caller-supplied one: that is what makes
    session fixation impossible here. An attacker who plants a session
    identifier in the victim's browser before login gains nothing, because
    authenticating replaces it rather than adopting it.
    """
    settings = get_settings()
    session_token = new_session_token()
    csrf_token = new_csrf_token()
    await store.put(
        session_token,
        new_session_record(user.id, user.email, csrf_token),
        settings.session_ttl_seconds,
    )
    set_session_cookies(response, session_token=session_token, csrf_token=csrf_token)
    return AccountSession(
        expires_in=settings.session_ttl_seconds,
        account_id=user.id,
        email=user.email,
        token=session_token if issue_bearer_token else None,
    )


@router.post("/register", response_model=AccountSession)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> AccountSession:
    await _rate_limit(store, request, "register")

    user = User(email=payload.email, account_password_hash=hash_account_password(payload.password))
    db.add(user)
    try:
        # A pre-flight SELECT would still race two concurrent registrations of
        # the same address; the unique index is the only real arbiter, so let
        # it be the one that decides. The savepoint keeps the surrounding
        # transaction usable after the violation.
        async with db.begin_nested():
            await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="email already registered"
        ) from exc

    return await _start_session(
        store, response, user, issue_bearer_token=payload.issue_bearer_token
    )


@router.post("/login", response_model=AccountSession)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> AccountSession:
    await _rate_limit(store, request, "login")

    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active or not user.account_password_hash:
        # Spend the same Argon2id work an existing account would, so latency
        # does not reveal which addresses have accounts.
        verify_decoy_password(payload.password)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials"
        )
    if not verify_account_password(payload.password, user.account_password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials"
        )

    return await _start_session(
        store, response, user, issue_bearer_token=payload.issue_bearer_token
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> None:
    """Revoke the presented session and clear the browser's cookies.

    Deliberately not behind ``get_current_user``: logging out an already
    invalid session must still succeed and still clear the cookies, or a user
    whose session expired can never get back to a clean state. It is
    idempotent and reveals nothing.
    """
    credential = read_presented_credential(request)
    if credential is not None:
        record = await store.get(credential.token)
        if record is not None:
            # Server-side revocation is state-changing, so a cross-site page
            # must not be able to trigger it just to be annoying.
            enforce_csrf(request, credential, record)
            await store.delete(credential.token)
    clear_session_cookies(response)


@router.get("/me", response_model=AccountMe)
async def me(user: Annotated[User, Depends(get_current_user)]) -> User:
    return user
