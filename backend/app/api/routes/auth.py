from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_session_store
from app.api.rate_limit import enforce_rate_limit
from app.core.config import get_settings
from app.core.security import hash_account_password, new_session_token, verify_account_password
from app.core.sessions import SessionRecord, SessionStore, assert_device_id
from app.models.user import User
from app.schemas.auth import AccountMe, AccountSession, LoginRequest, RegisterRequest

router = APIRouter(prefix="/auth", tags=["auth"])

# Internal storage identity for profile=local. Never a login form field.
LOCAL_ACCOUNT_EMAIL = "local@127.0.0.1"


def _require_device_id(x_device_id: str | None) -> str:
    try:
        return assert_device_id(x_device_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-Device-Id header required",
        ) from exc


def _session_out(token: str, user: User, device_id: str) -> AccountSession:
    settings = get_settings()
    return AccountSession(
        token=token,
        expires_in=settings.session_ttl_seconds,
        account_id=user.id,
        email=user.email,
        device_id=device_id,
    )


async def _mint(
    store: SessionStore, user: User, device_id: str
) -> AccountSession:
    token = new_session_token()
    await store.put(
        token,
        SessionRecord(user_id=user.id, email=user.email, device_id=device_id),
        get_settings().session_ttl_seconds,
    )
    return _session_out(token, user, device_id)


@router.post("/local", response_model=AccountSession)
async def local_bootstrap(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
    x_device_id: Annotated[str | None, Header()] = None,
) -> AccountSession:
    """Mint a storage session for the local app. No email, no account password.

    Only ``profile=local``. The account password is not a vault key. Server
    deployments keep email register/login.
    """
    if not get_settings().is_local():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not found")
    await enforce_rate_limit(store, request, "login")
    device_id = _require_device_id(x_device_id)
    result = await db.execute(select(User).where(User.email == LOCAL_ACCOUNT_EMAIL))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(email=LOCAL_ACCOUNT_EMAIL, account_password_hash=None, is_active=True)
        db.add(user)
        await db.flush()
    elif not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")
    return await _mint(store, user, device_id)


@router.post("/register", response_model=AccountSession)
async def register(
    payload: RegisterRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
    x_device_id: Annotated[str | None, Header()] = None,
) -> AccountSession:
    await enforce_rate_limit(store, request, "register")
    device_id = _require_device_id(x_device_id)
    email = str(payload.email).strip().lower()
    existing = await db.execute(select(User.id).where(func.lower(User.email) == email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="email already registered")

    user = User(email=email, account_password_hash=hash_account_password(payload.password))
    db.add(user)
    await db.flush()
    return await _mint(store, user, device_id)


@router.post("/login", response_model=AccountSession)
async def login(
    payload: LoginRequest,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
    x_device_id: Annotated[str | None, Header()] = None,
) -> AccountSession:
    await enforce_rate_limit(store, request, "login")
    device_id = _require_device_id(x_device_id)
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
    return await _mint(store, user, device_id)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> None:
    authorization = request.headers.get("authorization")
    if authorization and authorization.lower().startswith("bearer "):
        await store.delete(authorization.split(" ", 1)[1].strip())


@router.get("/me", response_model=AccountMe)
async def me(user: Annotated[User, Depends(get_current_user)]) -> AccountMe:
    return AccountMe(id=user.id, email=user.email, created_at=user.created_at)
