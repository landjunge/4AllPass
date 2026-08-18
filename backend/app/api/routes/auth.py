from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
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
    ip = request.client.host if request.client else "unknown"
    return f"{action}:{ip}"


def _session_out(user: User) -> AccountSession:
    settings = get_settings()
    return AccountSession(
        expires_in=settings.session_ttl_seconds,
        account_id=user.id,
        email=user.email,
    )


def _set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.use_secure_session_cookie,
        samesite=settings.session_cookie_samesite,
        path="/api/v1",
    )


def _clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=settings.use_secure_session_cookie,
        samesite=settings.session_cookie_samesite,
        path="/api/v1",
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
    await store.put(
        token,
        SessionRecord(user_id=user.id),
        get_settings().session_ttl_seconds,
    )
    _set_session_cookie(response, token)
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
    password_valid = verify_account_password(
        payload.password,
        user.account_password_hash if user is not None and user.is_active else None,
    )
    if (
        user is None
        or not user.is_active
        or not user.account_password_hash
        or not password_valid
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    token = new_session_token()
    await store.put(
        token,
        SessionRecord(user_id=user.id),
        get_settings().session_ttl_seconds,
    )
    _set_session_cookie(response, token)
    return _session_out(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> None:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        await store.delete(token)
    _clear_session_cookie(response)


@router.get("/me", response_model=AccountMe)
async def me(user: Annotated[User, Depends(get_current_user)]) -> User:
    return user
