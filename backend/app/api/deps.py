from __future__ import annotations

import hmac
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.sessions import SessionRecord, SessionStore, get_session_store
from app.db.redis import get_redis
from app.db.session import get_db
from app.models.user import User
from app.models.vault import Vault


@dataclass(frozen=True)
class CurrentSession:
    token: str
    record: SessionRecord
    cookie_authenticated: bool


async def get_current_session(
    request: Request,
    store: Annotated[SessionStore, Depends(get_session_store)],
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentSession:
    settings = get_settings()
    token: str | None = None
    cookie_authenticated = False
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    elif request.cookies.get(settings.session_cookie_name):
        token = request.cookies[settings.session_cookie_name]
        cookie_authenticated = True

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    record = await store.get(token)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid or expired session",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if cookie_authenticated and request.method.upper() not in {"GET", "HEAD", "OPTIONS"}:
        supplied = request.headers.get("x-csrf-token", "")
        cookie_csrf = request.cookies.get(settings.csrf_cookie_name, "")
        if (
            not supplied
            or not cookie_csrf
            or not hmac.compare_digest(supplied, cookie_csrf)
            or not hmac.compare_digest(supplied, record.csrf_token)
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
    return CurrentSession(token=token, record=record, cookie_authenticated=cookie_authenticated)


async def get_current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    session: Annotated[CurrentSession, Depends(get_current_session)],
) -> User:
    user = await db.get(User, session.record.user_id)
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
    "get_current_session",
    "get_current_user",
    "get_owned_vault",
    "get_session_store",
]
