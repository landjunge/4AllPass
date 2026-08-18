"""Account authentication — Security Boundary v1.

What a successful login proves: the caller holds the account password (or a
valid refresh token) for account X. What it does not prove, and cannot: any
ability to read vault plaintext. The Vault Key never reaches this service, so
these endpoints are about *identity and ownership only* (architecture.md §3,
crypto-protocol.md Hard Invariant #5).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import bearer_scheme, get_current_user, get_db, get_redis
from app.core.security import (
    AccessToken,
    InvalidTokenError,
    create_access_token,
    decode_access_token,
    hash_account_password,
    password_needs_rehash,
    verify_account_password,
)
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    LogoutRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserOut,
)
from app.services.refresh_tokens import (
    RefreshTokenError,
    issue_refresh_token,
    revoke_access_token,
    revoke_refresh_token,
    rotate_refresh_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])

_INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="invalid credentials",
    headers={"WWW-Authenticate": "Bearer"},
)
_INVALID_REFRESH = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="invalid refresh token",
    headers={"WWW-Authenticate": "Bearer"},
)


def _normalize_email(email: str) -> str:
    """Lower-case the address so `A@x.test` and `a@x.test` are one account.

    Only the case is normalized. Stripping dots or `+tags` would silently merge
    addresses their owners consider distinct.
    """
    return email.strip().lower()


async def _token_pair(redis: Redis, user: User) -> TokenPair:
    access: AccessToken = create_access_token(user.id)
    refresh = await issue_refresh_token(redis, user_id=user.id)
    return TokenPair(
        access_token=access.token,
        refresh_token=refresh.token,
        expires_in=access.expires_in,
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest,
    db: AsyncSession = Depends(get_db),
) -> User:
    """Create an account. Deliberately does not return tokens.

    Registration and session establishment are separate steps so that creating
    an account is never implicitly a login — the client calls `/auth/login`,
    through the same code path every other login uses.
    """
    email = _normalize_email(payload.email)
    user = User(email=email, account_password_hash=hash_account_password(payload.password))
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="email already registered"
        ) from None
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/login", response_model=TokenPair)
async def login(
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> TokenPair:
    email = _normalize_email(payload.email)
    result = await db.execute(select(User).where(func.lower(User.email) == email))
    user = result.scalar_one_or_none()

    # Runs the password comparison even when the account does not exist, so the
    # response time does not reveal which emails are registered.
    password_ok = verify_account_password(payload.password, user.account_password_hash if user else None)
    if user is None or not password_ok or not user.is_active:
        raise _INVALID_CREDENTIALS

    if password_needs_rehash(user.account_password_hash or ""):
        user.account_password_hash = hash_account_password(payload.password)

    tokens = await _token_pair(redis, user)
    await db.commit()
    return tokens


@router.post("/refresh", response_model=TokenPair)
async def refresh(
    payload: RefreshRequest,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> TokenPair:
    """Exchange a refresh token for a new pair, invalidating the old one.

    Reuse of an already-rotated token revokes the entire family (see
    `app.services.refresh_tokens`) and is reported as a plain 401: the client
    must re-authenticate, and the response says nothing about why.
    """
    try:
        user_id, issued = await rotate_refresh_token(redis, payload.refresh_token)
    except RefreshTokenError:
        raise _INVALID_REFRESH from None

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise _INVALID_REFRESH

    access = create_access_token(user.id)
    return TokenPair(
        access_token=access.token,
        refresh_token=issued.token,
        expires_in=access.expires_in,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    payload: LogoutRequest | None = None,
    user: User = Depends(get_current_user),
    credentials=Depends(bearer_scheme),
    redis: Redis = Depends(get_redis),
) -> Response:
    """Revoke the presented refresh-token family and the current access token.

    The access token is deny-listed until its own expiry, so logout takes effect
    immediately rather than at the end of its ~10-minute lifetime. Requiring
    authentication here means one account cannot log another one out.
    """
    if payload is not None and payload.refresh_token:
        await revoke_refresh_token(redis, payload.refresh_token)

    if credentials is not None and credentials.credentials:
        try:
            claims = decode_access_token(credentials.credentials)
        except InvalidTokenError:  # pragma: no cover - get_current_user already validated it
            claims = None
        if claims is not None:
            await revoke_access_token(redis, jti=claims.jti, expires_at=claims.expires_at)

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> User:
    """The calling account. Useful for clients to confirm a token is still live."""
    return user
