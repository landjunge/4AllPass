"""Account-level password hashing and session-token primitives.

This module is deliberately narrow: it hashes *account* passwords and mints
*session* tokens. It has nothing to do with vault cryptography.

    Account password  → Argon2id here, on the server, to verify a login.
    Master Password   → Argon2id in `packages/crypto`, on the client, to
                        derive the Master Key that unwraps the Vault Key.

They share an algorithm name and nothing else. The account password never
unlocks a vault (docs/crypto-protocol.md, Hard Invariant #5), and the vault
KDF profiles of docs/test-vectors-argon2id.md are not reused here: those are
tuned for a client that derives a key once per unlock, these for a server
that verifies many concurrent logins.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from functools import lru_cache

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

SESSION_TOKEN_BYTES = 32
"""256 bits of CSPRNG output — the token is the credential, so it carries full entropy."""

SESSION_TOKEN_MAX_CHARS = 128
"""Length bound on the cookie value, so a hostile client cannot make us hash megabytes."""


@lru_cache
def _hasher() -> PasswordHasher:
    settings = get_settings()
    return PasswordHasher(
        time_cost=settings.password_hash_time_cost,
        memory_cost=settings.password_hash_memory_cost_kib,
        parallelism=settings.password_hash_parallelism,
        hash_len=32,
        salt_len=16,
    )


@lru_cache
def _dummy_hash() -> str:
    """A throwaway hash used to equalize the cost of a login for an unknown account.

    Without it, "no such user" returns in microseconds while "wrong password"
    takes a full Argon2id verification, which turns the login endpoint into an
    account-existence oracle.
    """
    return _hasher().hash(secrets.token_urlsafe(32))


def hash_password(password: str) -> str:
    """Return a PHC-encoded Argon2id hash. The plaintext is never retained or logged."""
    return _hasher().hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """Verify a password against a stored hash in (approximately) constant time.

    ``password_hash`` is ``None`` for accounts that have no account password
    yet (OAuth-only, architecture.md §3). Those still pay for a dummy
    verification so they are indistinguishable from a wrong password.
    """
    if password_hash is None:
        verify_password_dummy()
        return False
    try:
        return _hasher().verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def verify_password_dummy() -> None:
    """Burn one verification's worth of work for an account that does not exist."""
    try:
        _hasher().verify(_dummy_hash(), "")
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        pass


def password_needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher().check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def generate_session_token() -> str:
    """Mint an opaque session token. Only the client ever holds this value."""
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def hash_session_token(token: str) -> bytes:
    """Digest a session token for storage and lookup.

    A plain SHA-256 is correct here — unlike a password, the token has full
    entropy, so there is no dictionary to slow down, and lookups have to stay
    cheap enough to run on every authenticated request.
    """
    return hashlib.sha256(token.encode("utf-8")).digest()


def tokens_equal(a: bytes, b: bytes) -> bool:
    return hmac.compare_digest(a, b)
