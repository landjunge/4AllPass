from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, loaded from environment variables / .env.

    Nothing in this settings object is, or ever should become, secret key
    material for vault decryption (see docs/threat-model.md, "Malicious /
    Active Server"). It only configures infrastructure: where Postgres and
    Redis live, and account-level auth plumbing.
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
    # "redis" in deployment; "memory" for pytest / single-process dev without Redis.
    session_backend: str = "redis"

    cors_origins: list[str] = ["http://localhost:5173"]

    crypto_protocol_version: int = 1
    webauthn_rp_id: str = "localhost"

    auth_min_password_length: int = 12
    auth_login_rate_limit: int = 10
    auth_login_rate_window_seconds: int = 60
    auth_write_rate_limit: int = 60
    auth_write_rate_window_seconds: int = 60


@lru_cache
def get_settings() -> Settings:
    return Settings()
