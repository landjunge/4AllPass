"""Account-password hashing and opaque session tokens.

This module is *account* auth only. It never derives, wraps, or unwraps a
Vault Key. The account password is independent of the Master Password
(architecture.md §3, crypto-protocol.md Hard Invariant #5).
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerifyMismatchError

from app.core.config import get_settings

_hasher = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=2, hash_len=32)


def hash_account_password(password: str) -> str:
    return _hasher.hash(password)


def verify_account_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHash):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def token_lookup_key(token: str) -> str:
    """Hash the bearer token before it touches Redis.

    A Redis dump then cannot be replayed as Authorization headers.
    HMAC with session_secret so a leaked hash still needs the server secret
    to be useful as an offline oracle; the token itself stays unrecoverable.
    """
    secret = get_settings().session_secret.encode("utf-8")
    return hmac.new(secret, token.encode("utf-8"), hashlib.sha256).hexdigest()
