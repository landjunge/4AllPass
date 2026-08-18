"""Session and rate-limit state in Redis."""

from redis.asyncio import Redis

from app.security import new_session_token, session_key


async def create_session(redis: Redis, account_id: str, ttl_seconds: int) -> tuple[str, int]:
    token = new_session_token()
    await redis.set(session_key(token), account_id, ex=ttl_seconds)
    return token, ttl_seconds


async def resolve_session(redis: Redis, token: str) -> str | None:
    return await redis.get(session_key(token))


async def revoke_session(redis: Redis, token: str) -> None:
    await redis.delete(session_key(token))


async def touch_session(redis: Redis, token: str, ttl_seconds: int) -> None:
    await redis.expire(session_key(token), ttl_seconds)


async def register_attempt(redis: Redis, bucket: str, limit: int, window_seconds: int = 60) -> bool:
    """Fixed-window counter. Returns False when the caller is over the limit."""
    key = f"ratelimit:{bucket}"
    async with redis.pipeline(transaction=True) as pipe:
        pipe.incr(key)
        pipe.expire(key, window_seconds)
        count, _ = await pipe.execute()
    return int(count) <= limit
