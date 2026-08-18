"""Account-level authentication.

This protects API access only. It is deliberately separate from the vault: no
value here can unwrap an envelope, and losing an account password does not lose
or expose a vault (crypto-protocol.md §1 invariant 5).
"""

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

#: Server-side account password hashing. Independent of the client-side
#: Argon2id profiles used for the master key.
_hasher = PasswordHasher(
    time_cost=3, memory_cost=64 * 1024, parallelism=4, hash_len=32, salt_len=16
)

SESSION_TOKEN_BYTES = 32


def hash_account_password(password: str) -> str:
    return _hasher.hash(password)


def verify_account_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def session_key(token: str) -> str:
    """Redis key for a session.

    Only the hash of the token is stored, so a dump of Redis does not hand an
    attacker usable session tokens.
    """
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return f"session:{digest}"


def constant_time_equals(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))
