from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.sessions import SessionStore, assert_device_id, get_session_store
from app.db.redis import get_redis
from app.db.session import get_db
from app.models.user import User
from app.models.vault import Vault


def bearer_token(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    return token or None


async def get_current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
    authorization: Annotated[str | None, Header()] = None,
    x_device_id: Annotated[str | None, Header()] = None,
) -> User:
    token = bearer_token(authorization)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        device_id = assert_device_id(x_device_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="device binding required",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    record = await store.get(token)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or expired session",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if record.device_id != device_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="session is bound to another device",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = await db.get(User, record.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or expired session",
            headers={"WWW-Authenticate": "Bearer"},
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


__all__ = [
    "get_db",
    "get_redis",
    "get_current_user",
    "get_owned_vault",
    "get_session_store",
    "bearer_token",
]
