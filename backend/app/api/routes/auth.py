from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import extract_session_token, get_current_user, get_db
from app.core.config import Settings, get_settings
from app.core.security import hash_password, verify_password
from app.core.sessions import clear_session_cookie, create_session, delete_session, set_session_cookie
from app.db.redis import get_redis_client
from app.models.user import User
from app.schemas.auth import MessageResponse, UserLogin, UserOut, UserRegister

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(
    payload: UserRegister,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> UserOut:
    """Register a new account.

    Derives a server-side Argon2id hash for account authentication and starts
    a new session. Note: This is strictly for account authentication and has
    zero relationship to the client-side Master Password KDF or Vault Key.
    """
    normalized_email = payload.email.strip().lower()

    existing_result = await db.execute(select(User).where(User.email == normalized_email))
    if existing_result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    password_hash = hash_password(payload.password)
    user = User(
        email=normalized_email,
        account_password_hash=password_hash,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    redis = get_redis_client()
    session_token = await create_session(redis, user.id, ttl_seconds=settings.session_ttl_seconds)
    set_session_cookie(response, session_token, settings)

    return UserOut.model_validate(user)


@router.post("/login", response_model=UserOut)
async def login(
    payload: UserLogin,
    response: Response,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> UserOut:
    """Authenticate with email and account password, issuing a new session cookie."""
    normalized_email = payload.email.strip().lower()

    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()

    if user is None:
        verify_password(payload.password, None)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not verify_password(payload.password, user.account_password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is inactive",
        )

    redis = get_redis_client()
    session_token = await create_session(redis, user.id, ttl_seconds=settings.session_ttl_seconds)
    set_session_cookie(response, session_token, settings)

    return UserOut.model_validate(user)


@router.post("/logout", response_model=MessageResponse)
async def logout(
    request: Request,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> MessageResponse:
    """Revoke active session and clear session cookie."""
    token = extract_session_token(request, settings)
    if token:
        redis = get_redis_client()
        await delete_session(redis, token)

    clear_session_cookie(response, settings)
    return MessageResponse(message="Logged out successfully")


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)) -> UserOut:
    """Get the currently authenticated user profile."""
    return UserOut.model_validate(current_user)
