import secrets
import uuid
from datetime import timedelta

from redis.asyncio import Redis

from app.core.config import Settings


class SessionStore:
    """Server-side, revocable sessions represented by opaque cookie values."""

    _key_prefix = "session:"

    def __init__(self, redis: Redis, settings: Settings) -> None:
        self._redis = redis
        self._settings = settings

    def _key(self, session_id: str) -> str:
        return f"{self._key_prefix}{session_id}"

    async def create(self, user_id: uuid.UUID) -> str:
        # Never reuse a client-provided identifier: this prevents session fixation.
        session_id = secrets.token_urlsafe(32)
        await self._redis.set(
            self._key(session_id),
            str(user_id),
            ex=timedelta(seconds=self._settings.session_ttl_seconds),
        )
        return session_id

    async def get_user_id(self, session_id: str) -> uuid.UUID | None:
        user_id = await self._redis.get(self._key(session_id))
        if not user_id:
            return None
        try:
            return uuid.UUID(user_id)
        except (TypeError, ValueError):
            # Corrupt session data must never authenticate a request.
            await self.revoke(session_id)
            return None

    async def revoke(self, session_id: str) -> None:
        await self._redis.delete(self._key(session_id))
