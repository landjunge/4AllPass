from collections.abc import AsyncIterator

from redis.asyncio import Redis

from app.core.config import get_settings

settings = get_settings()

_redis: Redis | None = None


def get_redis_client() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def get_redis() -> AsyncIterator[Redis]:
    """FastAPI dependency yielding the shared Redis client.

    Redis holds ephemeral, reconstructible state: rate limiting and WebAuthn
    challenge storage (short-lived, non-secret-key-material only — see
    docs/webauthn-prf.md). It never stores Vault Key material.

    Account sessions deliberately live in Postgres instead
    (docs/backend-security-boundary.md §2): a Redis restart must not sign
    every user out, and session revocation has to be as durable as the
    account it belongs to.
    """
    yield get_redis_client()
