import uuid

from fastapi import Depends, HTTPException, Request, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.sessions import get_session
from app.db.redis import get_redis, get_redis_client
from app.db.session import get_db
from app.models.user import User
from app.models.vault import Vault


def extract_session_token(request: Request, settings: Settings = Depends(get_settings)) -> str | None:
    """Extract session token from HttpOnly cookie or Bearer authorization header."""
    cookie_token = request.cookies.get(settings.session_cookie_name)
    if cookie_token:
        return cookie_token

    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        bearer_token = auth_header[7:].strip()
        if bearer_token:
            return bearer_token

    return None


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    """Authenticate the caller via server-side session.

    Rejects missing, invalid, or expired sessions with 401 Unauthorized.
    Never trusts any user_id provided in request bodies or query parameters.
    """
    token = extract_session_token(request, settings)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    redis = get_redis_client()
    session_data = await get_session(redis, token)
    if session_data is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(User).where(User.id == session_data.user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


async def require_vault_owner(
    vault_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Vault:
    """Enforce that the authenticated user owns the requested vault.

    Returns 404 (rather than 403) to prevent vault ID enumeration by unauthorized parties.
    """
    result = await db.execute(
        select(Vault).where(Vault.id == vault_id, Vault.owner_user_id == current_user.id)
    )
    vault = result.scalar_one_or_none()
    if vault is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vault not found",
        )
    return vault


__all__ = [
    "get_db",
    "get_redis",
    "extract_session_token",
    "get_current_user",
    "require_vault_owner",
]
