"""Rotating refresh tokens and access-token revocation, both in Redis.

Design notes that matter for the threat model:

* A refresh token is an opaque 256-bit random string, not a JWT. It carries no
  claims at all, so it cannot be read — let alone trusted — without this store.
* Only a SHA-256 of the token is used as the Redis key. A dump of Redis
  therefore does not yield usable tokens, the same reason a password database
  stores hashes. No stretching is needed here: the input is full-entropy random,
  not a guessable secret.
* Rotation is single-use with reuse detection. A rotated token is kept as a
  tombstone rather than deleted, so presenting it a second time is *detected*
  rather than merely rejected — and that detection revokes the whole token
  family, on the assumption that one of the two holders stole it.
* Nothing here can decrypt a vault. Redis stores account session state only
  (see app/db/redis.py).
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from redis.asyncio import Redis

from app.core.config import get_settings

_PREFIX = "4allpass:auth"


class RefreshTokenError(Exception):
    """The refresh token is unknown, expired, or malformed."""


class RefreshTokenReuseError(RefreshTokenError):
    """A rotated token was presented again — the family has been revoked."""


@dataclass(frozen=True)
class IssuedRefreshToken:
    token: str
    family: str
    expires_in: int


def _token_key(token: str) -> str:
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"{_PREFIX}:refresh:{digest}"


def _family_key(family: str) -> str:
    return f"{_PREFIX}:family:{family}"


def _access_revocation_key(jti: str) -> str:
    return f"{_PREFIX}:revoked-access:{jti}"


async def issue_refresh_token(
    redis: Redis, *, user_id: uuid.UUID, family: str | None = None
) -> IssuedRefreshToken:
    """Mint a refresh token, optionally continuing an existing family."""
    settings = get_settings()
    token = secrets.token_urlsafe(settings.refresh_token_bytes)
    token_family = family or uuid.uuid4().hex
    ttl = settings.refresh_token_ttl_seconds
    key = _token_key(token)

    pipe = redis.pipeline()
    pipe.hset(
        key,
        mapping={
            "user_id": str(user_id),
            "family": token_family,
            "used": "0",
            "issued_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    pipe.expire(key, ttl)
    pipe.sadd(_family_key(token_family), key)
    pipe.expire(_family_key(token_family), ttl)
    await pipe.execute()

    return IssuedRefreshToken(token=token, family=token_family, expires_in=ttl)


async def revoke_family(redis: Redis, family: str) -> None:
    """Invalidate every token of a family, including tombstones."""
    family_key = _family_key(family)
    members = await redis.smembers(family_key)
    pipe = redis.pipeline()
    for member in members:
        pipe.delete(member)
    pipe.delete(family_key)
    await pipe.execute()


async def rotate_refresh_token(redis: Redis, token: str) -> tuple[uuid.UUID, IssuedRefreshToken]:
    """Consume `token` and issue its successor.

    Raises `RefreshTokenReuseError` if the token was already rotated, after
    revoking the whole family: either the client replayed a token it should have
    dropped, or someone else is holding a copy. Both warrant re-authentication.
    """
    if not token:
        raise RefreshTokenError("refresh token is empty")

    key = _token_key(token)
    record = await redis.hgetall(key)
    if not record:
        raise RefreshTokenError("refresh token is unknown or expired")

    family = record.get("family", "")
    if record.get("used") == "1":
        if family:
            await revoke_family(redis, family)
        raise RefreshTokenReuseError("refresh token was already used; family revoked")

    try:
        user_id = uuid.UUID(record["user_id"])
    except (KeyError, ValueError) as exc:
        raise RefreshTokenError("refresh token record is malformed") from exc

    # Tombstone rather than delete: a replay must be distinguishable from an
    # expiry, which is what turns a stolen token into a detected event.
    ttl = await redis.ttl(key)
    pipe = redis.pipeline()
    pipe.hset(key, "used", "1")
    pipe.expire(key, ttl if ttl and ttl > 0 else get_settings().refresh_token_ttl_seconds)
    await pipe.execute()

    issued = await issue_refresh_token(redis, user_id=user_id, family=family or None)
    return user_id, issued


async def revoke_refresh_token(redis: Redis, token: str) -> bool:
    """Revoke a single token and its family. Returns whether it was known.

    Logout revokes the family, not just the presented token: a logout that left
    sibling tokens alive would be a logout only in the user interface.
    """
    if not token:
        return False
    record = await redis.hgetall(_token_key(token))
    if not record:
        return False
    family = record.get("family")
    if family:
        await revoke_family(redis, family)
    else:
        await redis.delete(_token_key(token))
    return True


async def revoke_access_token(redis: Redis, *, jti: str, expires_at: datetime) -> None:
    """Deny-list an access token id until it would have expired anyway.

    Access tokens are stateless by design, so this is the one piece of state
    that makes logout effective inside the remaining ~10 minutes. The entry
    expires with the token, so the deny-list stays small.
    """
    ttl = int((expires_at - datetime.now(timezone.utc)).total_seconds())
    if ttl <= 0:
        return
    await redis.set(_access_revocation_key(jti), "1", ex=ttl)


async def is_access_token_revoked(redis: Redis, jti: str) -> bool:
    return await redis.exists(_access_revocation_key(jti)) == 1
