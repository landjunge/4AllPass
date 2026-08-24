"""Server-issued WebAuthn ceremony challenges.

The challenge is *not* vault-key material. It exists so each create/get is
bound to this account, this vault, a purpose, and a short TTL — and can be
used only once. The PRF output never touches this store.

Storage is the same backend as account sessions (Redis in production, memory
in tests). The raw challenge is returned once at issue time; only its digest
is retained.
"""

from __future__ import annotations

import hashlib
import json
import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Literal, Protocol
from uuid import UUID

from app.core.config import get_settings
from app.db.redis import get_redis_client

ChallengePurpose = Literal["create", "assert"]
CHALLENGE_BYTES = 32
CHALLENGE_PREFIX = "webauthn:chal:"


@dataclass(frozen=True)
class IssuedChallenge:
    challenge_id: UUID
    challenge: bytes
    expires_in: int


@dataclass(frozen=True)
class StoredChallenge:
    challenge_id: UUID
    user_id: UUID
    vault_id: UUID
    purpose: ChallengePurpose
    device_id: str | None
    digest: str


def digest_challenge(challenge: bytes) -> str:
    return hashlib.sha256(challenge).hexdigest()


class ChallengeStore(Protocol):
    async def issue(
        self,
        *,
        user_id: UUID,
        vault_id: UUID,
        purpose: ChallengePurpose,
        device_id: str | None,
        ttl_seconds: int,
    ) -> IssuedChallenge: ...

    async def consume(
        self,
        *,
        challenge_id: UUID,
        user_id: UUID,
        vault_id: UUID,
        purpose: ChallengePurpose,
        challenge: bytes,
        device_id: str | None = None,
    ) -> StoredChallenge | None: ...


class MemoryChallengeStore:
    def __init__(self) -> None:
        self._items: dict[str, tuple[float, StoredChallenge]] = {}

    async def issue(
        self,
        *,
        user_id: UUID,
        vault_id: UUID,
        purpose: ChallengePurpose,
        device_id: str | None,
        ttl_seconds: int,
    ) -> IssuedChallenge:
        raw = secrets.token_bytes(CHALLENGE_BYTES)
        challenge_id = uuid.uuid4()
        record = StoredChallenge(
            challenge_id=challenge_id,
            user_id=user_id,
            vault_id=vault_id,
            purpose=purpose,
            device_id=device_id,
            digest=digest_challenge(raw),
        )
        self._items[str(challenge_id)] = (time.time() + ttl_seconds, record)
        return IssuedChallenge(challenge_id=challenge_id, challenge=raw, expires_in=ttl_seconds)

    async def consume(
        self,
        *,
        challenge_id: UUID,
        user_id: UUID,
        vault_id: UUID,
        purpose: ChallengePurpose,
        challenge: bytes,
        device_id: str | None = None,
    ) -> StoredChallenge | None:
        key = str(challenge_id)
        item = self._items.pop(key, None)
        if item is None:
            return None
        expires_at, record = item
        if expires_at < time.time():
            return None
        if (
            record.user_id != user_id
            or record.vault_id != vault_id
            or record.purpose != purpose
            or record.digest != digest_challenge(challenge)
            or (record.device_id is not None and record.device_id != device_id)
        ):
            return None
        return record


class RedisChallengeStore:
    async def issue(
        self,
        *,
        user_id: UUID,
        vault_id: UUID,
        purpose: ChallengePurpose,
        device_id: str | None,
        ttl_seconds: int,
    ) -> IssuedChallenge:
        raw = secrets.token_bytes(CHALLENGE_BYTES)
        challenge_id = uuid.uuid4()
        payload = json.dumps(
            {
                "user_id": str(user_id),
                "vault_id": str(vault_id),
                "purpose": purpose,
                "device_id": device_id,
                "digest": digest_challenge(raw),
            }
        )
        await get_redis_client().set(CHALLENGE_PREFIX + str(challenge_id), payload, ex=ttl_seconds)
        return IssuedChallenge(challenge_id=challenge_id, challenge=raw, expires_in=ttl_seconds)

    async def consume(
        self,
        *,
        challenge_id: UUID,
        user_id: UUID,
        vault_id: UUID,
        purpose: ChallengePurpose,
        challenge: bytes,
        device_id: str | None = None,
    ) -> StoredChallenge | None:
        key = CHALLENGE_PREFIX + str(challenge_id)
        redis = get_redis_client()
        raw = await redis.getdel(key)
        if not raw:
            return None
        data = json.loads(raw)
        record = StoredChallenge(
            challenge_id=challenge_id,
            user_id=UUID(data["user_id"]),
            vault_id=UUID(data["vault_id"]),
            purpose=data["purpose"],
            device_id=data.get("device_id"),
            digest=data["digest"],
        )
        if (
            record.user_id != user_id
            or record.vault_id != vault_id
            or record.purpose != purpose
            or record.digest != digest_challenge(challenge)
            or (record.device_id is not None and record.device_id != device_id)
        ):
            return None
        return record


_memory = MemoryChallengeStore()


def get_challenge_store() -> ChallengeStore:
    if get_settings().session_backend == "memory":
        return _memory
    return RedisChallengeStore()
