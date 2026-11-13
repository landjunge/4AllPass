from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.sessions import SessionStore, assert_device_id, get_session_store
from app.db.redis import get_redis
from app.db.session import get_db
from app.models.device import Device
from app.models.user import User
from app.models.vault import Vault


def bearer_token(authorization: str | None) -> str | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    return token or None


async def get_current_user(
    request: Request,
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
    # Keep the validated session binding for route-level checks. This is not a
    # second auth layer: the same lookup already happened above, and the value
    # is only read by `get_writable_vault`.
    request.state.session_device_id = device_id
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


async def get_writable_vault(
    request: Request,
    vault: Annotated[Vault, Depends(get_owned_vault)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Vault:
    """Ownership first (404), then refuse mutations from a revoked device row.

    AP-E03-P04 interim: a device whose metadata row is revoked in *this* vault
    may read (recovery stays available) but must not mutate. Without this, the
    same client could `POST /devices` to clear `revoked_at` and then commit a
    snapshot with its old envelope again, defeating the metadata revoke.

    Scope: only the session's device id in the addressed vault. A device
    revoked in vault A may still write vault B, a device without a row is
    unaffected, and this does not prove Vault Key possession — ADR-015 §3
    (signed writes) remains the open fix for a stolen token.
    """
    device_id = getattr(request.state, "session_device_id", None)
    if device_id is None:  # pragma: no cover - get_current_user guarantees it
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    revoked = await db.execute(
        select(Device.id).where(
            Device.vault_id == vault.id,
            Device.device_id == device_id,
            Device.revoked_at.is_not(None),
        )
    )
    if revoked.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="device is revoked for this vault",
        )
    return vault


__all__ = [
    "get_db",
    "get_redis",
    "get_current_user",
    "get_owned_vault",
    "get_writable_vault",
    "get_session_store",
    "bearer_token",
]
