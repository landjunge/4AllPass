"""Account-password hashing, opaque session tokens, and CSRF tokens.

This module is *account* auth only. It never derives, wraps, or unwraps a
Vault Key. The account password is independent of the Master Password
(architecture.md §3, crypto-protocol.md Hard Invariant #5).

The Argon2id parameters here are deliberately *not* the vault KDF profiles of
docs/test-vectors-argon2id.md. Vault Argon2id defends a stolen database
against an offline attacker who has all the time in the world; this one only
has to make an online guessing attack expensive while running on every login
request. They are separate concerns with separate cost budgets, and coupling
them would mean a server-side performance decision could silently weaken vault
encryption.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from functools import lru_cache

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


@lru_cache(maxsize=1)
def _decoy_password_hash() -> str:
    """An Argon2id hash of a random string that no one can ever supply.

    Verifying against this on the "no such account" path keeps login latency
    flat. Without it, a missing account answers in microseconds while an
    existing one pays for a 64 MiB Argon2id verification, and that difference
    is a remote account-enumeration oracle that needs no response body at all.
    """
    return hash_account_password(secrets.token_urlsafe(32))


def verify_decoy_password(password: str) -> None:
    """Burn the same work a real verification would, then discard the result."""
    verify_account_password(password, _decoy_password_hash())


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def token_lookup_key(token: str) -> str:
    """Hash a bearer/CSRF token before it touches Redis.

    A Redis dump then cannot be replayed as Authorization headers.
    HMAC with session_secret so a leaked hash still needs the server secret
    to be useful as an offline oracle; the token itself stays unrecoverable.
    """
    secret = get_settings().session_secret.encode("utf-8")
    return hmac.new(secret, token.encode("utf-8"), hashlib.sha256).hexdigest()


def tokens_match(presented: str, expected_lookup_key: str) -> bool:
    """Constant-time check of a presented token against a stored lookup key."""
    return hmac.compare_digest(token_lookup_key(presented), expected_lookup_key)
