from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.sessions import SessionStore, get_session_store, session_cookie_name
from app.db.redis import get_redis
from app.db.session import get_db
from app.models.user import User
from app.models.vault import Vault


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> User:
    """Authenticate from the server-side session cookie.

    Identity never comes from a client-supplied ``user_id`` / ``owner_id``
    header, query parameter, or body field.
    """
    token = request.cookies.get(session_cookie_name())
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
        )
    record = await store.get(token)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
        )
    user = await db.get(User, record.user_id)
    if user is None or not user.is_active:
        await store.delete(token)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
        )
    return user


async def require_vault_owner(
    vault_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> Vault:
    """Return the vault only if the authenticated user owns it.

    Missing and foreign vaults are both 404 so vault ids cannot be
    enumerated across accounts. ``owner_user_id`` is read from the row,
    never from the request.
    """
    result = await db.execute(
        select(Vault)
        .where(Vault.id == vault_id, Vault.owner_user_id == current_user.id)
        .options(selectinload(Vault.active_snapshot))
    )
    vault = result.scalar_one_or_none()
    if vault is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vault not found")
    return vault


# Retained name used by earlier routes / docs.
get_owned_vault = require_vault_owner


__all__ = [
    "get_db",
    "get_redis",
    "get_current_user",
    "get_owned_vault",
    "require_vault_owner",
    "get_session_store",
]
