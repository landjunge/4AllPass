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


# Argon2id over a fixed, unreachable password. Computed once at import so the
# cost is paid at startup rather than on the first unknown-account login.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(32))


def spend_verify_time() -> None:
    """Burn one Argon2id verification for a login that has no account to check.

    Without this, `login` short-circuits on a missing user and answers in
    milliseconds, while a real account costs a full 64 MiB derivation. That gap
    is a reliable account-enumeration oracle: the rate limit slows the scan but
    does not remove the signal.
    """
    verify_account_password("", _DUMMY_HASH)


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
