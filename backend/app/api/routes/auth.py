from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_session_store
from app.core.config import get_settings
from app.core.security import hash_account_password, new_session_token, verify_account_password
from app.core.sessions import SessionRecord, SessionStore
from app.models.user import User
from app.schemas.auth import AccountMe, AccountSession, LoginRequest, RegisterRequest

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_bucket(request: Request, action: str) -> str:
    """Best-effort per-client key for the login/register rate limiter.

    Not a security boundary by itself (an attacker who controls their source
    IP, or sits behind the same NAT/proxy as other users, can still share a
    bucket) — it only has to make credential-stuffing/enumeration slower, not
    impossible. ``trust_forwarded_for`` must stay off unless a trusted reverse
    proxy guarantees the header cannot be spoofed by the client.
    """
    ip = None
    if get_settings().trust_forwarded_for:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip = forwarded.split(",")[0].strip()
    if not ip:
        ip = request.client.host if request.client else "unknown"
    return f"{action}:{ip}"


def _session_out(token: str, user: User) -> AccountSession:
    settings = get_settings()
    return AccountSession(
        token=token,
        expires_in=settings.session_ttl_seconds,
        account_id=user.id,
        email=user.email,
    )


async def _rate_limit(store: SessionStore, request: Request, action: str) -> None:
    settings = get_settings()
    if await store.hit_rate_limit(
        _client_bucket(request, action),
        settings.auth_login_rate_limit,
        settings.auth_login_rate_window_seconds,
    ):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too many attempts")


@router.post("/register", response_model=AccountSession)
async def register(
    payload: RegisterRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> AccountSession:
    await _rate_limit(store, request, "register")
    email = str(payload.email).strip().lower()
    existing = await db.execute(select(User.id).where(func.lower(User.email) == email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already registered")

    user = User(email=email, account_password_hash=hash_account_password(payload.password))
    db.add(user)
    await db.flush()

    token = new_session_token()
    await store.put(
        token,
        SessionRecord(user_id=user.id, email=user.email),
        get_settings().session_ttl_seconds,
    )
    return _session_out(token, user)


@router.post("/login", response_model=AccountSession)
async def login(
    payload: LoginRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> AccountSession:
    await _rate_limit(store, request, "login")
    email = str(payload.email).strip().lower()
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    user = result.scalar_one_or_none()
    if (
        user is None
        or not user.is_active
        or not user.account_password_hash
        or not verify_account_password(payload.password, user.account_password_hash)
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    token = new_session_token()
    await store.put(
        token,
        SessionRecord(user_id=user.id, email=user.email),
        get_settings().session_ttl_seconds,
    )
    return _session_out(token, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> None:
    authorization = request.headers.get("authorization")
    if authorization and authorization.lower().startswith("bearer "):
        await store.delete(authorization.split(" ", 1)[1].strip())


@router.get("/me", response_model=AccountMe)
async def me(user: Annotated[User, Depends(get_current_user)]) -> User:
    return user
