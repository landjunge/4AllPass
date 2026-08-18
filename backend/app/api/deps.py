from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.sessions import SessionStore, get_session_store
from app.db.redis import get_redis
from app.db.session import get_db
from app.models.user import User
from app.models.vault import Vault


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> User:
    token = request.cookies.get(get_settings().session_cookie_name)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
        )
    record = await store.get(token)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or expired session",
        )
    user = await db.get(User, record.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or expired session",
        )
    return user


async def get_owned_vault(
    vault_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Vault:
    """Return the vault only if the caller owns it.

    Missing and foreign vaults are both 404 so vault ids cannot be enumerated
    across accounts.
    """
    result = await db.execute(
        select(Vault)
        .where(Vault.id == vault_id, Vault.owner_user_id == user.id)
        .options(selectinload(Vault.active_snapshot))
    )
    vault = result.scalar_one_or_none()
    if vault is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vault not found")
    return vault


__all__ = ["get_db", "get_redis", "get_current_user", "get_owned_vault", "get_session_store"]
