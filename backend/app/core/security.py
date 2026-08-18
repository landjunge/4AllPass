"""Account-level security primitives: password hashing and access tokens.

Scope boundary, stated once and relied on everywhere else: everything in this
module authenticates an *account*. None of it can decrypt a vault, and none of
it is an input to any vault key derivation (crypto-protocol.md, Hard Invariant
#5). A valid access token means "this request comes from account X" — never
"this request may read plaintext".
"""

from __future__ import annotations

import logging
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519

from app.core.config import get_settings

logger = logging.getLogger(__name__)




class InvalidTokenError(Exception):
    """The presented access token is missing, malformed, expired or not ours."""


@dataclass(frozen=True)
class AccessToken:
    token: str
    jti: str
    expires_in: int
    expires_at: datetime


@dataclass(frozen=True)
class AccessClaims:
    """The complete claim set. Deliberately nothing else is carried.

    In particular there are no vault ids, device ids, roles or scopes: a token
    never grants access to an object. Authorization is always a fresh database
    lookup against the owning account (see `app.api.deps.get_vault_for_user`).
    """

    subject: uuid.UUID
    jti: str
    issued_at: datetime
    expires_at: datetime


@lru_cache
def _password_hasher() -> PasswordHasher:
    settings = get_settings()
    return PasswordHasher(
        time_cost=settings.argon2_time_cost,
        memory_cost=settings.argon2_memory_kib,
        parallelism=settings.argon2_parallelism,
        hash_len=32,
        salt_len=16,
    )


@lru_cache
def _dummy_hash() -> str:
    """A real hash of a random password, verified when the account is unknown.

    Generated rather than hard-coded so it always matches the configured
    parameters — a stale literal would fail to parse and return early, which is
    exactly the timing difference this exists to remove.
    """
    return _password_hasher().hash(secrets.token_urlsafe(32))


def hash_account_password(password: str) -> str:
    return _password_hasher().hash(password)


def verify_account_password(password: str, password_hash: str | None) -> bool:
    """Verify a password, spending the same work when the account is unknown.

    `password_hash` is `None` for OAuth-only accounts (`users.account_password_hash`
    is nullable). Those accounts have no password to verify, but the comparison
    still runs so that their existence is not observable through timing.
    """
    hasher = _password_hasher()
    try:
        hasher.verify(password_hash or _dummy_hash(), password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return password_hash is not None


def password_needs_rehash(password_hash: str) -> bool:
    try:
        return _password_hasher().check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def _generate_dev_key(algorithm: str):
    if algorithm == "ES256":
        return ec.generate_private_key(ec.SECP256R1())
    return ed25519.Ed25519PrivateKey.generate()


@lru_cache
def _signing_key():
    """Load the configured signing key, or generate an ephemeral development one.

    Production must configure a key: generating one per process would silently
    invalidate every token on restart and would break any horizontally scaled
    deployment, where two instances would sign with different keys.
    """
    settings = get_settings()
    if settings.jwt_private_key:
        return serialization.load_pem_private_key(
            settings.jwt_private_key.encode("utf-8"), password=None
        )
    if settings.is_production:
        raise RuntimeError(
            "FOURALLPASS_JWT_PRIVATE_KEY must be set in production: an ephemeral "
            "key would invalidate all access tokens on restart and would differ "
            "between instances."
        )
    logger.warning(
        "No FOURALLPASS_JWT_PRIVATE_KEY configured — generating an ephemeral "
        "%s key. Access tokens will not survive a restart.",
        settings.jwt_algorithm,
    )
    return _generate_dev_key(settings.jwt_algorithm)


def _verification_key():
    return _signing_key().public_key()


def public_key_pem() -> str:
    """The public half, for verifiers that are not this process."""
    return (
        _verification_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("utf-8")
    )


def create_access_token(subject: uuid.UUID, *, now: datetime | None = None) -> AccessToken:
    settings = get_settings()
    issued_at = now or datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(seconds=settings.access_token_ttl_seconds)
    jti = uuid.uuid4().hex
    payload = {
        "sub": str(subject),
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": jti,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    token = jwt.encode(
        payload,
        _signing_key(),
        algorithm=settings.jwt_algorithm,
    )
    return AccessToken(
        token=token,
        jti=jti,
        expires_in=settings.access_token_ttl_seconds,
        expires_at=expires_at,
    )


def decode_access_token(token: str) -> AccessClaims:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            _verification_key(),
            algorithms=[settings.jwt_algorithm],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            options={"require": ["sub", "iat", "exp", "jti", "iss", "aud"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidTokenError(str(exc)) from exc

    try:
        subject = uuid.UUID(payload["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise InvalidTokenError("sub is not a user id") from exc

    jti = payload.get("jti")
    if not isinstance(jti, str) or not jti:
        raise InvalidTokenError("jti is missing")

    return AccessClaims(
        subject=subject,
        jti=jti,
        issued_at=datetime.fromtimestamp(payload["iat"], tz=timezone.utc),
        expires_at=datetime.fromtimestamp(payload["exp"], tz=timezone.utc),
    )
