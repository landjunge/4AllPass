from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_session_store
from app.core.config import get_settings
from app.core.security import dummy_verify_account_password, hash_account_password, verify_account_password
from app.core.sessions import (
    SessionRecord,
    SessionStore,
    clear_session_cookie,
    issue_session,
    session_cookie_name,
    set_session_cookie,
)
from app.models.user import User
from app.schemas.auth import AccountMe, LoginRequest, RegisterRequest

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
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too many attempts")


def _me(user: User) -> AccountMe:
    return AccountMe.model_validate(user)


@router.post("/register", response_model=AccountMe)
async def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> AccountMe:
    await _rate_limit(store, request, "register")
    email = str(payload.email).strip().lower()
    existing = await db.execute(select(User.id).where(func.lower(User.email) == email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already registered")

    user = User(email=email, account_password_hash=hash_account_password(payload.password))
    db.add(user)
    await db.flush()

    token = await issue_session(
        store,
        SessionRecord(user_id=user.id, email=user.email),
        previous_token=request.cookies.get(session_cookie_name()),
    )
    set_session_cookie(response, token)
    return _me(user)


@router.post("/login", response_model=AccountMe)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> AccountMe:
    await _rate_limit(store, request, "login")
    email = str(payload.email).strip().lower()
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    user = result.scalar_one_or_none()
    if user is None or not user.account_password_hash:
        dummy_verify_account_password(payload.password)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")
    if not user.is_active or not verify_account_password(payload.password, user.account_password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")

    token = await issue_session(
        store,
        SessionRecord(user_id=user.id, email=user.email),
        previous_token=request.cookies.get(session_cookie_name()),
    )
    set_session_cookie(response, token)
    return _me(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> None:
    token = request.cookies.get(session_cookie_name())
    if token:
        await store.delete(token)
    clear_session_cookie(response)


@router.get("/me", response_model=AccountMe)
async def me(current_user: Annotated[User, Depends(get_current_user)]) -> AccountMe:
    return _me(current_user)
