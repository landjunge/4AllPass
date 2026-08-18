"""Request-scoped dependencies: database, Redis, identity, and authorization.

These four form the trust boundary described in
docs/backend-security-boundary.md:

    request → get_current_session → get_current_user → get_owned_vault → data

Nothing below the boundary re-derives identity. A route that wants to know who
is calling declares ``Depends(get_current_user)``; a route that touches a vault
declares ``Depends(get_owned_vault)``. Neither ever reads an identity out of
the request body, the query string or a path parameter.
"""

from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, Path, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authz import require_vault_owner
from app.core.sessions import read_session_cookie, resolve_session
from app.db.redis import get_redis
from app.db.session import get_db
from app.models.session import UserSession
from app.models.user import User
from app.models.vault import Vault

__all__ = [
    "get_db",
    "get_redis",
    "get_current_session",
    "get_current_user",
    "get_owned_vault",
    "get_owned_vault_with_snapshot",
]


def _unauthenticated() -> HTTPException:
    """One answer for missing, unknown, expired and revoked sessions alike."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="not authenticated",
    )


async def get_current_session(
    request: Request, db: AsyncSession = Depends(get_db)
) -> UserSession:
    """Resolve the caller's session from the cookie, or reject the request.

    The token is read from the ``HttpOnly`` cookie only. There is no header
    fallback and no query-parameter fallback, so a session token can never end
    up in a URL, a log line or a ``Referer``.
    """
    token = read_session_cookie(request)
    if token is None:
        raise _unauthenticated()

    session = await resolve_session(db, token)
    if session is None:
        raise _unauthenticated()
    return session


async def get_current_user(session: UserSession = Depends(get_current_session)) -> User:
    """The authenticated account.

    This is the only place a ``User`` enters a request. It is loaded from the
    session row, so a ``user_id`` in a body, path or header has no way of
    becoming the caller's identity.
    """
    return session.user


async def get_owned_vault(
    vault_id: uuid.UUID = Path(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Vault:
    """The vault named in the path, if the authenticated account owns it."""
    return await require_vault_owner(vault_id, current_user, db)


async def get_owned_vault_with_snapshot(
    vault_id: uuid.UUID = Path(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Vault:
    return await require_vault_owner(vault_id, current_user, db, with_active_snapshot=True)
