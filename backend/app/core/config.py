from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, loaded from environment variables / .env.

    Nothing in this settings object is, or ever should become, secret key
    material for vault decryption (see docs/threat-model.md, "Malicious /
    Active Server"). It only configures infrastructure: where Postgres and
    Redis live, and account-level auth plumbing.

    There is deliberately no session signing secret: sessions are opaque
    random tokens stored as SHA-256 digests in Postgres, so there is no
    token payload to sign. See docs/backend-security-boundary.md §2.
    """

    model_config = SettingsConfigDict(env_file=".env", env_prefix="FOURALLPASS_", extra="ignore")

    app_name: str = "4AllPass API"
    environment: str = "development"
    debug: bool = False

    database_url: str = "postgresql+asyncpg://fourallpass:fourallpass@localhost:5432/fourallpass"
    redis_url: str = "redis://localhost:6379/0"

    # Account-level session auth (unrelated to vault crypto — see architecture.md §3).
    session_ttl_seconds: int = Field(default=60 * 60 * 24 * 14, ge=60)
    session_cookie_name: str = "fourallpass_session"
    session_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    session_cookie_path: str = "/"
    session_cookie_domain: str | None = None
    # Left unset, `Secure` is on everywhere except a development environment,
    # so a misconfigured deployment fails closed.
    session_cookie_secure: bool | None = None
    # `last_used_at` is only rewritten once per interval, so an authenticated
    # read does not turn into a write on every request.
    session_touch_interval_seconds: int = Field(default=60, ge=0)

    # Account password hashing (Argon2id). Independent of the vault KDF profiles
    # in docs/test-vectors-argon2id.md: those derive the Master Key on the
    # client, these only verify an account login on the server.
    password_hash_time_cost: int = Field(default=3, ge=1, le=16)
    password_hash_memory_cost_kib: int = Field(default=65536, ge=8, le=1024 * 1024)
    password_hash_parallelism: int = Field(default=4, ge=1, le=16)
    password_min_length: int = Field(default=12, ge=8)
    password_max_length: int = Field(default=1024, ge=64)

    cors_origins: list[str] = ["http://localhost:5173"]

    crypto_protocol_version: int = 1

    @property
    def is_production(self) -> bool:
        return self.environment.lower() not in {"development", "dev", "local", "test"}

    @property
    def cookie_secure(self) -> bool:
        if self.session_cookie_secure is not None:
            return self.session_cookie_secure
        return self.is_production

    @model_validator(mode="after")
    def _reject_insecure_samesite_none(self) -> "Settings":
        # SameSite=None without Secure is rejected by browsers outright, and it
        # would drop the only CSRF barrier the cookie itself provides.
        if self.session_cookie_samesite == "none" and not self.cookie_secure:
            raise ValueError("session_cookie_samesite='none' requires session_cookie_secure=True")
        return self

    @model_validator(mode="after")
    def _reject_wildcard_cors_origin(self) -> "Settings":
        # The API is credentialed, so a wildcard is not the harmless default it
        # looks like: Starlette echoes the caller's own origin back when
        # credentials are allowed, which lets any site read a signed-in user's
        # vault metadata. Origins must be named.
        if "*" in self.cors_origins:
            raise ValueError(
                "cors_origins must name explicit origins; '*' with credentialed "
                "requests would let any site read a signed-in user's data"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
