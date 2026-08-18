"""Request dependencies: database, Redis, caller identity, vault ownership.

The two authorization rules of Security Boundary v1 live here:

1. `get_current_user` — the caller must present a valid, non-revoked access
   token for an active account.
2. `require_vault_owner` — the vault named in the path must be owned by that
   account, checked against the database on every request.

Nothing is inferred from the token itself. A token carries no vault ids, no
device ids and no scopes, so possession of one can never *be* an authorization
(crypto-protocol.md, Hard Invariant #5).
"""

from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, Path, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import InvalidTokenError, decode_access_token
from app.db.redis import get_redis
from app.db.session import get_db
from app.models.user import User
from app.models.vault import Vault
from app.services.refresh_tokens import is_access_token_revoked

# auto_error=False so a missing header produces our own 401 with a
# WWW-Authenticate challenge, rather than FastAPI's bare 403.
bearer_scheme = HTTPBearer(auto_error=False, description="Account access token")

_UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> User:
    """Resolve the calling account, or fail with 401.

    Every failure mode — no header, bad signature, expired, revoked by logout,
    unknown or deactivated account — returns the same response. Distinguishing
    them would tell an attacker which tokens and accounts exist.
    """
    if credentials is None or not credentials.credentials:
        raise _UNAUTHENTICATED

    try:
        claims = decode_access_token(credentials.credentials)
    except InvalidTokenError:
        raise _UNAUTHENTICATED from None

    if await is_access_token_revoked(redis, claims.jti):
        raise _UNAUTHENTICATED

    user = await db.get(User, claims.subject)
    if user is None or not user.is_active:
        raise _UNAUTHENTICATED
    return user


async def require_vault_owner(
    vault_id: uuid.UUID = Path(..., description="Vault the request applies to"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Vault:
    """Require that the calling account owns `vault_id`, and return that vault.

    The ownership check and the load are one operation on purpose: a route that
    received only a boolean would have to fetch the vault again, and a second
    query is a second chance to fetch it with the wrong predicate. The single
    `WHERE id = … AND owner_user_id = …` cannot be got wrong that way.

    A vault owned by somebody else is reported as 404, not 403: 403 would
    confirm that the id exists, which is a membership oracle over other
    accounts' vaults. "Not found" is also the honest answer — as far as this
    caller is concerned, it does not exist.
    """
    result = await db.execute(
        select(Vault).where(Vault.id == vault_id, Vault.owner_user_id == user.id)
    )
    vault = result.scalar_one_or_none()
    if vault is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vault not found")
    return vault


__all__ = [
    "bearer_scheme",
    "get_current_user",
    "get_db",
    "get_redis",
    "require_vault_owner",
]
