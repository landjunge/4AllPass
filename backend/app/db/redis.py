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

    Redis is used for account-level sessions, rate limiting, and WebAuthn
    challenge storage (short-lived, non-secret-key-material state only —
    see docs/webauthn-prf.md). It never stores Vault Key material.
    """
    yield get_redis_client()
