import logging
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

logger = logging.getLogger(__name__)

# Standard OWASP recommended configuration for server-side password hashing.
# Note: This is purely for account authentication on the server and is separate
# from the client-side Zero-Knowledge Argon2id KDF used for the Master Key (crypto-protocol.md §4).
_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
)

# Precomputed dummy hash for constant-time verification when a user does not exist,
# preventing timing-based email enumeration.
_DUMMY_HASH = _hasher.hash("dummy-password-for-timing-mitigation")


def hash_password(password: str) -> str:
    """Hash a plaintext account password using Argon2id."""
    return _hasher.hash(password)


def verify_password(plain_password: str, hashed_password: str | None) -> bool:
    """Verify a plaintext password against an Argon2id hash.

    If hashed_password is None, verifies against a dummy hash to prevent
    timing side-channels, and always returns False.
    """
    if hashed_password is None:
        try:
            _hasher.verify(_DUMMY_HASH, plain_password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            pass
        return False

    try:
        return _hasher.verify(hashed_password, plain_password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
