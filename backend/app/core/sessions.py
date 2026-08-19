"""Revocable account sessions.

Stored state is never vault key material. Redis holds
``{user_id, email, device_id}`` under a HMAC of the bearer token. Logout
deletes the key. Memory backend exists so the pytest suite does not require
Redis.

A session is bound to the client-asserted device id presented at login
(``X-Device-Id``). That is not a cryptographic proof of possession — it
stops a stolen token from being used without that id, and it lets device
revocation kill the other device's sessions.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from app.core.config import get_settings
from app.core.security import token_lookup_key
from app.db.redis import get_redis_client

SESSION_PREFIX = "sess:"
DEVICE_INDEX_PREFIX = "sess:dev:"
RATE_PREFIX = "auth:rl:"

DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,80}$")


def assert_device_id(value: str | None) -> str:
    if value is None or DEVICE_ID_RE.fullmatch(value) is None:
        raise ValueError("invalid device id")
    return value


@dataclass(frozen=True)
class SessionRecord:
    user_id: UUID
    email: str
    device_id: str


class SessionStore(Protocol):
    async def put(self, token: str, record: SessionRecord, ttl_seconds: int) -> None: ...
    async def get(self, token: str) -> SessionRecord | None: ...
    async def delete(self, token: str) -> None: ...
    async def revoke_device(
        self, user_id: UUID, device_id: str, *, keep_token: str | None = None
    ) -> int: ...
    async def hit_rate_limit(self, bucket: str, limit: int, window_seconds: int) -> bool: ...


class MemorySessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, tuple[float, SessionRecord]] = {}
        self._by_device: dict[tuple[str, str], set[str]] = {}
        self._rates: dict[str, list[float]] = {}

    def reset(self) -> None:
        """Test helper: drop every session and rate-limit window."""
        self._sessions.clear()
        self._by_device.clear()
        self._rates.clear()

    def _index_key(self, record: SessionRecord) -> tuple[str, str]:
        return (str(record.user_id), record.device_id)

    async def put(self, token: str, record: SessionRecord, ttl_seconds: int) -> None:
        lookup = token_lookup_key(token)
        existing = self._sessions.get(lookup)
        if existing is not None:
            self._by_device.get(self._index_key(existing[1]), set()).discard(lookup)
        self._sessions[lookup] = (time.time() + ttl_seconds, record)
        self._by_device.setdefault(self._index_key(record), set()).add(lookup)

    async def get(self, token: str) -> SessionRecord | None:
        item = self._sessions.get(token_lookup_key(token))
        if item is None:
            return None
        expires_at, record = item
        if expires_at < time.time():
            await self.delete(token)
            return None
        return record

    async def delete(self, token: str) -> None:
        lookup = token_lookup_key(token)
        item = self._sessions.pop(lookup, None)
        if item is None:
            return
        bucket = self._by_device.get(self._index_key(item[1]))
        if bucket is not None:
            bucket.discard(lookup)
            if not bucket:
                self._by_device.pop(self._index_key(item[1]), None)

    async def revoke_device(
        self, user_id: UUID, device_id: str, *, keep_token: str | None = None
    ) -> int:
        keep = token_lookup_key(keep_token) if keep_token else None
        bucket = self._by_device.get((str(user_id), device_id), set()).copy()
        removed = 0
        for lookup in bucket:
            if keep is not None and lookup == keep:
                continue
            item = self._sessions.pop(lookup, None)
            if item is None:
                continue
            self._by_device.get((str(user_id), device_id), set()).discard(lookup)
            removed += 1
        leftover = self._by_device.get((str(user_id), device_id))
        if leftover is not None and not leftover:
            self._by_device.pop((str(user_id), device_id), None)
        return removed

    async def hit_rate_limit(self, bucket: str, limit: int, window_seconds: int) -> bool:
        now = time.time()
        window = [t for t in self._rates.get(bucket, []) if t > now - window_seconds]
        window.append(now)
        self._rates[bucket] = window
        return len(window) > limit


class RedisSessionStore:
    def _device_key(self, user_id: UUID, device_id: str) -> str:
        return f"{DEVICE_INDEX_PREFIX}{user_id}:{device_id}"

    async def put(self, token: str, record: SessionRecord, ttl_seconds: int) -> None:
        lookup = token_lookup_key(token)
        payload = json.dumps(
            {"user_id": str(record.user_id), "email": record.email, "device_id": record.device_id}
        )
        redis = get_redis_client()
        await redis.set(SESSION_PREFIX + lookup, payload, ex=ttl_seconds)
        index = self._device_key(record.user_id, record.device_id)
        await redis.sadd(index, lookup)
        await redis.expire(index, ttl_seconds)

    async def get(self, token: str) -> SessionRecord | None:
        raw = await get_redis_client().get(SESSION_PREFIX + token_lookup_key(token))
        if not raw:
            return None
        data = json.loads(raw)
        device_id = data.get("device_id")
        if not device_id:
            return None
        return SessionRecord(
            user_id=UUID(data["user_id"]), email=data["email"], device_id=device_id
        )

    async def delete(self, token: str) -> None:
        redis = get_redis_client()
        lookup = token_lookup_key(token)
        raw = await redis.get(SESSION_PREFIX + lookup)
        await redis.delete(SESSION_PREFIX + lookup)
        if not raw:
            return
        data = json.loads(raw)
        device_id = data.get("device_id")
        if device_id:
            await redis.srem(self._device_key(UUID(data["user_id"]), device_id), lookup)

    async def revoke_device(
        self, user_id: UUID, device_id: str, *, keep_token: str | None = None
    ) -> int:
        redis = get_redis_client()
        index = self._device_key(user_id, device_id)
        members = await redis.smembers(index)
        keep = token_lookup_key(keep_token) if keep_token else None
        removed = 0
        for lookup in members:
            if keep is not None and lookup == keep:
                continue
            await redis.delete(SESSION_PREFIX + lookup)
            await redis.srem(index, lookup)
            removed += 1
        return removed

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
