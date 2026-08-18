from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, loaded from environment variables / .env.

    Nothing in this settings object is, or ever should become, secret key
    material for vault decryption (see docs/threat-model.md, "Malicious /
    Active Server"). It only configures infrastructure: where Postgres and
    Redis live, and account-level auth plumbing.

    The JWT signing key below is exactly that kind of account-level material:
    it proves *who is asking*, and it can neither decrypt a vault nor be used
    to derive anything that can. A stolen signing key lets an attacker
    impersonate accounts against this API; it does not weaken the vault
    (crypto-protocol.md, Hard Invariant #5).
    """

    model_config = SettingsConfigDict(env_file=".env", env_prefix="FOURALLPASS_", extra="ignore")

    app_name: str = "4AllPass API"
    environment: str = "development"
    debug: bool = False

    database_url: str = "postgresql+asyncpg://fourallpass:fourallpass@localhost:5432/fourallpass"
    redis_url: str = "redis://localhost:6379/0"

    # Account-level session auth (unrelated to vault crypto — see architecture.md §3).
    session_secret: str = "change-me-in-production"
    session_ttl_seconds: int = 60 * 60 * 24 * 14

    # --- Access tokens (asymmetric, short-lived) ---------------------------
    # EdDSA (Ed25519) by default; ES256 is supported for deployments that need
    # a NIST curve. HMAC algorithms are deliberately not offered: with an
    # asymmetric key the API is the only component that needs the private half.
    jwt_algorithm: Literal["EdDSA", "ES256"] = "EdDSA"
    # PKCS#8 PEM. Required in production; generated ephemerally otherwise, in
    # which case every restart invalidates outstanding access tokens.
    jwt_private_key: str | None = None
    jwt_issuer: str = "4allpass"
    jwt_audience: str = "4allpass-api"
    access_token_ttl_seconds: int = 10 * 60

    # --- Refresh tokens (opaque, rotating, Redis-backed) ------------------
    refresh_token_ttl_seconds: int = 60 * 60 * 24 * 14
    refresh_token_bytes: int = 32

    # --- Account password hashing (Argon2id) ------------------------------
    # Separate from the vault KDF in every respect: different parameters,
    # different purpose, and this hash never leaves the server. The vault's
    # Argon2id profile is pinned in docs/crypto-protocol.md §4 and is chosen by
    # the *client*; this one only protects the account password at rest here.
    account_password_min_length: int = 12
    account_password_max_length: int = 1024
    argon2_memory_kib: int = 64 * 1024
    argon2_time_cost: int = 3
    argon2_parallelism: int = 4

    cors_origins: list[str] = ["http://localhost:5173"]

    crypto_protocol_version: int = 1

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
