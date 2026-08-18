"""Account authentication endpoints.

Authentication ≠ vault decryption: these endpoints establish *who is
talking to the server* and nothing else. The account password verified
here is distinct from the Master Password; no Vault Key, Device Key, DWK,
PRF output, or plaintext ever transits these routes (architecture.md §3,
docs/backend-security.md).

Nothing in this module logs request bodies, passwords, or session tokens.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db, get_redis
from app.core import security, sessions
from app.core.config import get_settings
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.resolved_session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=settings.resolved_session_cookie_secure,
        samesite=settings.session_cookie_samesite,
        path="/",
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)) -> User:
    email = payload.email.lower()
    user = User(email=email, account_password_hash=security.hash_password(payload.password))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="email already registered"
        ) from None
    await db.refresh(user)
    return user


@router.post("/login", response_model=UserOut)
async def login(
    payload: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> User:
    result = await db.execute(select(User).where(User.email == payload.email.lower()))
    user = result.scalar_one_or_none()

    # verify_password hashes even when the user is unknown or has no
    # password (OAuth-only account), keeping timing uniform.
    password_hash = user.account_password_hash if user is not None else None
    if not security.verify_password(payload.password, password_hash) or user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid email or password"
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid email or password"
        )

    # A fresh token is minted on every login; a pre-existing cookie value is
    # never re-used or promoted (session-fixation defense).
    token = await sessions.create_session(redis, user.id)
    _set_session_cookie(response, token)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    request: Request,
    response: Response,
    redis: Redis = Depends(get_redis),
) -> None:
    """Revoke the presented session server-side and clear the cookie.

    Idempotent: logging out without a (valid) session is still a 204 —
    there is nothing useful to leak about whether a cookie was live.
    """
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        await sessions.revoke_session(redis, token)
    _clear_session_cookie(response)


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user
