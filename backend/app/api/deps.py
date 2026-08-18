import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.sessions import SessionStore
from app.db.redis import get_redis
from app.db.session import get_db
from app.models.user import User
from app.models.vault import Vault


def get_session_store(redis: Annotated[Redis, Depends(get_redis)]) -> SessionStore:
    return SessionStore(redis, get_settings())


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    sessions: Annotated[SessionStore, Depends(get_session_store)],
) -> User:
    session_id = request.cookies.get(get_settings().session_cookie_name)
    if not session_id:
        raise HTTPException(status_code=401, detail="authentication required")

    user_id = await sessions.get_user_id(session_id)
    if user_id is None:
        raise HTTPException(status_code=401, detail="authentication required")

    user = await db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
    if user is None:
        await sessions.revoke(session_id)
        raise HTTPException(status_code=401, detail="authentication required")
    return user


async def require_vault_owner(
    vault_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Vault:
    """Return a vault only when owned by the authenticated user.

    Missing and foreign vault IDs have the same response to limit enumeration.
    """
    vault = await db.scalar(
        select(Vault).where(Vault.id == vault_id, Vault.owner_user_id == current_user.id)
    )
    if vault is None:
        raise HTTPException(status_code=404, detail="vault not found")
    return vault


__all__ = [
    "get_current_user",
    "get_db",
    "get_redis",
    "get_session_store",
    "require_vault_owner",
]
