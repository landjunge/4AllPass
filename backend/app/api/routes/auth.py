from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentSession, get_current_session, get_current_user, get_db, get_session_store
from app.core.config import get_settings
from app.core.security import hash_account_password, new_session_token, verify_account_password
from app.core.sessions import SessionRecord, SessionStore
from app.models.user import User
from app.schemas.auth import AccountMe, AccountSession, LoginRequest, RegisterRequest

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_bucket(request: Request, action: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{action}:{ip}"


def _set_session_cookies(response: Response, token: str, csrf_token: str) -> None:
    settings = get_settings()
    secure = settings.environment.lower() in {"production", "prod"}
    common = {
        "max_age": settings.session_ttl_seconds,
        "secure": secure,
        "samesite": "lax",
        "path": "/api/v1",
    }
    response.set_cookie(settings.session_cookie_name, token, httponly=True, **common)
    response.set_cookie(settings.csrf_cookie_name, csrf_token, httponly=False, **common)


def _clear_session_cookies(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(settings.session_cookie_name, path="/api/v1")
    response.delete_cookie(settings.csrf_cookie_name, path="/api/v1")


def _session_out(user: User) -> AccountSession:
    settings = get_settings()
    return AccountSession(
        expires_in=settings.session_ttl_seconds,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.session_ttl_seconds),
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
    response: Response,
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
    csrf_token = new_session_token()
    await store.put(
        token,
        SessionRecord(user_id=user.id, email=user.email, csrf_token=csrf_token),
        get_settings().session_ttl_seconds,
    )
    _set_session_cookies(response, token, csrf_token)
    return _session_out(user)


@router.post("/login", response_model=AccountSession)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
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
    csrf_token = new_session_token()
    await store.put(
        token,
        SessionRecord(user_id=user.id, email=user.email, csrf_token=csrf_token),
        get_settings().session_ttl_seconds,
    )
    _set_session_cookies(response, token, csrf_token)
    return _session_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    session: Annotated[CurrentSession, Depends(get_current_session)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> None:
    await store.delete(session.token)
    _clear_session_cookies(response)


@router.get("/me", response_model=AccountMe)
async def me(user: Annotated[User, Depends(get_current_user)]) -> User:
    return user
