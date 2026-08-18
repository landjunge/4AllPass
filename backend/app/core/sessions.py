"""Revocable account sessions.

Stored state is never vault key material. Redis holds ``{user_id, email}``
under a HMAC of the bearer token. Logout deletes the key. Memory backend
exists so the pytest suite does not require Redis.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from app.core.config import get_settings
from app.core.security import token_lookup_key
from app.db.redis import get_redis_client

SESSION_PREFIX = "sess:"
RATE_PREFIX = "auth:rl:"


@dataclass(frozen=True)
class SessionRecord:
    user_id: UUID
    email: str


class SessionStore(Protocol):
    async def put(self, token: str, record: SessionRecord, ttl_seconds: int) -> None: ...
    async def get(self, token: str) -> SessionRecord | None: ...
    async def delete(self, token: str) -> None: ...
    async def hit_rate_limit(self, bucket: str, limit: int, window_seconds: int) -> bool: ...


class MemorySessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, tuple[float, SessionRecord]] = {}
        self._rates: dict[str, list[float]] = {}

    def reset(self) -> None:
        """Test helper: drop every session and rate-limit window."""
        self._sessions.clear()
        self._rates.clear()

    async def put(self, token: str, record: SessionRecord, ttl_seconds: int) -> None:
        self._sessions[token_lookup_key(token)] = (time.time() + ttl_seconds, record)

    async def get(self, token: str) -> SessionRecord | None:
        item = self._sessions.get(token_lookup_key(token))
        if item is None:
            return None
        expires_at, record = item
        if expires_at < time.time():
            self._sessions.pop(token_lookup_key(token), None)
            return None
        return record

    async def delete(self, token: str) -> None:
        self._sessions.pop(token_lookup_key(token), None)

    async def hit_rate_limit(self, bucket: str, limit: int, window_seconds: int) -> bool:
        now = time.time()
        window = [t for t in self._rates.get(bucket, []) if t > now - window_seconds]
        window.append(now)
        self._rates[bucket] = window
        return len(window) > limit


class RedisSessionStore:
    async def put(self, token: str, record: SessionRecord, ttl_seconds: int) -> None:
        payload = json.dumps({"user_id": str(record.user_id), "email": record.email})
        await get_redis_client().set(SESSION_PREFIX + token_lookup_key(token), payload, ex=ttl_seconds)

    async def get(self, token: str) -> SessionRecord | None:
        raw = await get_redis_client().get(SESSION_PREFIX + token_lookup_key(token))
        if not raw:
            return None
        data = json.loads(raw)
        return SessionRecord(user_id=UUID(data["user_id"]), email=data["email"])

    async def delete(self, token: str) -> None:
        await get_redis_client().delete(SESSION_PREFIX + token_lookup_key(token))

    async def hit_rate_limit(self, bucket: str, limit: int, window_seconds: int) -> bool:
        key = RATE_PREFIX + bucket
        redis = get_redis_client()
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window_seconds)
        return int(count) > limit


_memory = MemorySessionStore()


def get_session_store() -> SessionStore:
    if get_settings().session_backend == "memory":
        return _memory
    return RedisSessionStore()
