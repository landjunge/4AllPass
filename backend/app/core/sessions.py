"""Server-side account sessions — opaque tokens in Redis.

Design (documented in docs/backend-security.md):

- A session token is 256 bits from the OS CSPRNG, delivered to the browser
  only as an HttpOnly cookie. It is *opaque*: it carries no claims, so
  there is nothing to sign and no JWT infrastructure to get wrong.
- Redis stores ``session:<sha256(token)> -> user_id`` with a TTL. Storing
  the digest instead of the token means a leaked Redis dump/backup does not
  yield usable session cookies.
- Revocation is deletion of the key (logout) or TTL expiry. Because the
  server is the single source of truth, "session reuse after logout" and
  "expired session reuse" fail closed.
- Session fixation is structurally impossible: the server never accepts a
  client-chosen session identifier — login always mints a fresh token.

A session authenticates the *account* only. It has no relationship to the
Vault Key hierarchy; holding a valid session never allows the server or
anyone else to decrypt vault contents (crypto-protocol.md, threat-model.md).
"""

import hashlib
import secrets
import uuid

from redis.asyncio import Redis

from app.core.config import get_settings

_KEY_PREFIX = "session:"


def _redis_key(token: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"{_KEY_PREFIX}{digest}"


async def create_session(redis: Redis, user_id: uuid.UUID) -> str:
    """Mint a fresh opaque session token for ``user_id`` and return it."""
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    await redis.set(_redis_key(token), str(user_id), ex=settings.session_ttl_seconds)
    return token


async def get_session_user_id(redis: Redis, token: str) -> uuid.UUID | None:
    """Resolve a presented token to a user id, or None if unknown/expired."""
    if not token:
        return None
    value = await redis.get(_redis_key(token))
    if value is None:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


async def revoke_session(redis: Redis, token: str) -> None:
    """Invalidate a session server-side (logout)."""
    if token:
        await redis.delete(_redis_key(token))
