"""Account-password hashing — authentication only, never vault crypto.

This module hashes the **account password** (architecture.md §3,
"Account-Login"). It is deliberately separate from the vault KDF in
``packages/crypto`` (crypto-protocol.md §4): the account password
authenticates a user to the server; the Master Password — which never
leaves the client — decrypts the vault. Neither this hash, nor anything
else on the server, can ever decrypt a vault (Hard Invariant #5).

Server-side Argon2id parameters here are an operational choice of this
service and intentionally do NOT follow the client KDF profiles in
docs/crypto-protocol.md §9; the two must never be conflated.
"""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# argon2-cffi defaults follow the RFC 9106 low-memory profile and are
# maintained upstream; we pin nothing vault-related here on purpose.
_hasher = PasswordHasher()

# A real hash of an unguessable random value, verified for accounts that do
# not exist so that login timing does not reveal whether an email is
# registered (user-enumeration hardening).
_DUMMY_HASH = _hasher.hash("4allpass-dummy-password-for-timing-equalization")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """Constant-shape verification: unknown user / no hash still costs one hash."""
    target = password_hash if password_hash else _DUMMY_HASH
    try:
        _hasher.verify(target, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return password_hash is not None


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)
