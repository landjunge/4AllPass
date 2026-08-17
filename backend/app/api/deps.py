import uuid
from typing import Annotated

from fastapi import Depends, Header, Request
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import session_dependency
from app.errors import AuthenticationError
from app.models import Account, Vault
from app.redis_client import get_redis
from app.services import accounts as account_service
from app.services import sessions as session_service
from app.services import vaults as vault_service

SessionDep = Annotated[AsyncSession, Depends(session_dependency)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
RedisDep = Annotated[Redis, Depends(get_redis)]


def bearer_token(
    authorization: Annotated[str | None, Header()] = None,
    request: Request = None,  # type: ignore[assignment]
) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    cookie = request.cookies.get(get_settings().session_cookie_name) if request else None
    if cookie:
        return cookie
    raise AuthenticationError("missing session token")


async def current_account(
    session: SessionDep,
    redis: RedisDep,
    settings: SettingsDep,
    token: Annotated[str, Depends(bearer_token)],
) -> Account:
    account_id = await session_service.resolve_session(redis, token)
    if account_id is None:
        raise AuthenticationError("session expired")
    account = await account_service.get_account(session, uuid.UUID(account_id))
    if account is None or not account.is_active:
        raise AuthenticationError("account is not active")
    await session_service.touch_session(redis, token, settings.session_ttl_seconds)
    return account


AccountDep = Annotated[Account, Depends(current_account)]


async def current_vault(vault_id: str, session: SessionDep, account: AccountDep) -> Vault:
    return await vault_service.get_vault(session, account.id, vault_id)


VaultDep = Annotated[Vault, Depends(current_vault)]
