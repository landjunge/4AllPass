"""Revocable account sessions.

The browser holds only an opaque session id in an HttpOnly cookie. Redis
(or the in-memory store used by pytest) maps an HMAC of that id to
``{user_id, email}``. Logout deletes the key. The cookie value is never
vault key material and is never written to a log line by this module.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from fastapi import Response

from app.core.config import get_settings
from app.core.security import new_session_token, token_lookup_key
from app.db.redis import get_redis_client

SESSION_PREFIX = "sess:"
RATE_PREFIX = "auth:rl:"
DEFAULT_SESSION_SECRET = "change-me-in-production"


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

    def clear(self) -> None:
        self._sessions.clear()
        self._rates.clear()


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


def reset_memory_store() -> None:
    """Drop in-process sessions and rate-limit buckets (pytest isolation)."""
    _memory.clear()


def session_cookie_name() -> str:
    return get_settings().session_cookie_name


def _cookie_secure() -> bool:
    return get_settings().environment == "production"


def set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    samesite = settings.session_cookie_samesite.lower()
    if samesite not in {"lax", "strict", "none"}:
        samesite = "lax"
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=_cookie_secure() or samesite == "none",
        samesite=samesite,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=_cookie_secure(),
        samesite=settings.session_cookie_samesite.lower(),
    )


async def issue_session(store: SessionStore, record: SessionRecord, previous_token: str | None = None) -> str:
    """Mint a new session and revoke the previous cookie value (session fixation)."""
    if previous_token:
        await store.delete(previous_token)
    token = new_session_token()
    await store.put(token, record, get_settings().session_ttl_seconds)
    return token


def assert_production_session_secret() -> None:
    settings = get_settings()
    if settings.environment == "production" and settings.session_secret == DEFAULT_SESSION_SECRET:
        raise RuntimeError(
            "FOURALLPASS_SESSION_SECRET must be set to a random value in production"
        )
