"""Revocable account sessions.

Stored state is never vault key material. The store holds
``{user_id, email, csrf_token_hash, created_at}`` under an HMAC of the bearer
token; logout deletes the key. A memory backend exists so the pytest suite
does not require Redis.

Expiry is **absolute**, not sliding: the TTL is fixed when the session is
created and no request extends it, so a stolen session has a bounded life
even if the thief keeps it warm.

The CSRF token is stored as a lookup key rather than in the clear for the same
reason the session token is: whoever reads the store must not come away with
anything they can present back to the API.
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
    csrf_token_hash: str
    created_at: float


class SessionStore(Protocol):
    async def put(self, token: str, record: SessionRecord, ttl_seconds: int) -> None: ...
    async def get(self, token: str) -> SessionRecord | None: ...
    async def delete(self, token: str) -> None: ...
    async def hit_rate_limit(self, bucket: str, limit: int, window_seconds: int) -> bool: ...


def _encode(record: SessionRecord) -> str:
    return json.dumps(
        {
            "user_id": str(record.user_id),
            "email": record.email,
            "csrf": record.csrf_token_hash,
            "created_at": record.created_at,
        }
    )


def _decode(raw: str) -> SessionRecord:
    data = json.loads(raw)
    return SessionRecord(
        user_id=UUID(data["user_id"]),
        email=data["email"],
        csrf_token_hash=data.get("csrf", ""),
        created_at=float(data.get("created_at", 0.0)),
    )


class MemorySessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, tuple[float, SessionRecord]] = {}
        self._rates: dict[str, list[float]] = {}

    async def put(self, token: str, record: SessionRecord, ttl_seconds: int) -> None:
        self._sessions[token_lookup_key(token)] = (time.time() + ttl_seconds, record)

    async def get(self, token: str) -> SessionRecord | None:
        key = token_lookup_key(token)
        item = self._sessions.get(key)
        if item is None:
            return None
        expires_at, record = item
        if expires_at < time.time():
            self._sessions.pop(key, None)
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

    def clear_rate_limits(self) -> None:
        """Drop all rate-limit counters.

        This backend is a process-wide singleton, so every test shares one
        bucket keyed on the same client address. Without a reset between
        tests, whether a test sees a 429 depends on how many accounts the
        tests before it happened to create.
        """
        self._rates.clear()


class RedisSessionStore:
    async def put(self, token: str, record: SessionRecord, ttl_seconds: int) -> None:
        await get_redis_client().set(
            SESSION_PREFIX + token_lookup_key(token), _encode(record), ex=ttl_seconds
        )

    async def get(self, token: str) -> SessionRecord | None:
        raw = await get_redis_client().get(SESSION_PREFIX + token_lookup_key(token))
        if not raw:
            return None
        return _decode(raw)

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


def new_session_record(user_id: UUID, email: str, csrf_token: str) -> SessionRecord:
    return SessionRecord(
        user_id=user_id,
        email=email,
        csrf_token_hash=token_lookup_key(csrf_token),
        created_at=time.time(),
    )
