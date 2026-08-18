from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.cookies import CSRF_HEADER_NAME
from app.core.security import tokens_match
from app.core.sessions import SessionRecord, SessionStore, get_session_store
from app.db.redis import get_redis
from app.db.session import get_db
from app.models.user import User
from app.models.vault import Vault

CredentialSource = Literal["cookie", "bearer"]

# Methods that must not change state, and so cannot be a CSRF target.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

_UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)
_INVALID_SESSION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="invalid or expired session",
    headers={"WWW-Authenticate": "Bearer"},
)


@dataclass(frozen=True)
class PresentedCredential:
    token: str
    source: CredentialSource


def read_presented_credential(request: Request) -> PresentedCredential | None:
    """Find the caller's session token.

    ``Authorization`` wins over the cookie when both are present. An explicit
    header is not ambient authority — the caller had to hold the token and
    attach it deliberately — so it is the safer of the two to honour, and it
    keeps a stale cookie from shadowing a deliberate API call.
    """
    authorization = request.headers.get("authorization")
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if token:
            return PresentedCredential(token=token, source="bearer")

    cookie = request.cookies.get(get_settings().session_cookie_name)
    if cookie:
        return PresentedCredential(token=cookie, source="cookie")
    return None


def enforce_csrf(request: Request, credential: PresentedCredential, record: SessionRecord) -> None:
    """Require a session-bound CSRF token for unsafe cookie-authenticated calls.

    Bearer callers are exempt: their credential is not attached automatically
    by the browser, so a cross-site page cannot make the request in the first
    place.

    The presented token is compared against the value bound to *this* session,
    not merely against the CSRF cookie. Plain double-submit trusts that nobody
    else can write the victim's cookies, which a same-site subdomain attacker
    can. Binding it to the session removes that assumption.
    """
    if credential.source != "cookie" or request.method.upper() in SAFE_METHODS:
        return

    presented = request.headers.get(CSRF_HEADER_NAME)
    if not presented or not record.csrf_token_hash:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="csrf token missing")
    if not tokens_match(presented, record.csrf_token_hash):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="csrf token invalid")


async def resolve_session(
    request: Request, store: SessionStore
) -> tuple[PresentedCredential, SessionRecord]:
    credential = read_presented_credential(request)
    if credential is None:
        raise _UNAUTHENTICATED
    record = await store.get(credential.token)
    if record is None:
        raise _INVALID_SESSION
    return credential, record


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    store: Annotated[SessionStore, Depends(get_session_store)],
) -> User:
    """The authenticated account, or 401.

    The identity comes from the server-side session record only. Nothing the
    client sends in a path, query, or body is ever consulted to decide *who*
    is calling.
    """
    credential, record = await resolve_session(request, store)
    enforce_csrf(request, credential, record)

    user = await db.get(User, record.user_id)
    if user is None or not user.is_active:
        raise _INVALID_SESSION
    return user


async def get_owned_vault(
    vault_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
) -> Vault:
    """Return the vault only if the caller owns it.

    Ownership is part of the query, not a check performed after loading: there
    is no code path that holds another account's ``Vault`` object.

    Missing and foreign vaults are both 404, so the response cannot be used to
    decide whether a vault id exists on this server.
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
    "PresentedCredential",
    "enforce_csrf",
    "get_current_user",
    "get_db",
    "get_owned_vault",
    "get_redis",
    "get_session_store",
    "read_presented_credential",
    "resolve_session",
]
