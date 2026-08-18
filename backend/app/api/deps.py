import uuid

from fastapi import Depends, HTTPException, Request, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import sessions
from app.core.config import get_settings
from app.db.redis import get_redis
from app.db.session import get_db
from app.models.user import User
from app.models.vault import Vault

__all__ = ["get_db", "get_redis", "get_current_user", "get_owned_vault"]

_UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated"
)

# Foreign vaults and nonexistent vaults are indistinguishable (both 404),
# so vault ids cannot be enumerated by probing (docs/backend-security.md).
_VAULT_NOT_FOUND = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vault not found")


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> User:
    """Authenticate the request from its session cookie.

    The authenticated identity comes exclusively from the server-side
    session store — a user id supplied anywhere in the request (path,
    query, headers, body) is never trusted as identity.
    """
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise _UNAUTHENTICATED

    user_id = await sessions.get_session_user_id(redis, token)
    if user_id is None:
        raise _UNAUTHENTICATED

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise _UNAUTHENTICATED
    return user


async def get_owned_vault(
    vault_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Vault:
    """Authorization gate: resolve ``vault_id`` only if the caller owns it.

    Ownership is checked in the query itself (``owner_user_id ==
    current_user.id``), so there is no code path that loads a foreign
    vault first and filters later. Both "does not exist" and "not yours"
    yield the same 404, preventing IDOR and vault-id enumeration.
    """
    result = await db.execute(
        select(Vault).where(Vault.id == vault_id, Vault.owner_user_id == current_user.id)
    )
    vault = result.scalar_one_or_none()
    if vault is None:
        raise _VAULT_NOT_FOUND
    return vault
