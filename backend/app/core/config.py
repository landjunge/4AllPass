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
    # "local" = one-origin desktop/sidecar (SQLite, memory sessions, static UI).
    # "server" = Postgres/Redis blob store behind a reverse proxy.
    profile: str = "server"

    database_url: str = "postgresql+asyncpg://fourallpass:fourallpass@localhost:5432/fourallpass"
    redis_url: str = "redis://localhost:6379/0"
    listen_host: str = "127.0.0.1"
    listen_port: int = 8000
    ui_dist: str | None = None
    data_dir: str | None = None
    # Loopback access relay. Local profile serves it on the same origin.
    # Pairing token is not a vault key. FastAPI still never mints provider tokens.
    broker_url: str = "http://127.0.0.1:8788"
    broker_token: str = ""

    # Account-level session auth (unrelated to vault crypto — see architecture.md §3).
    session_secret: str = "change-me-in-production"
    session_ttl_seconds: int = 60 * 60 * 24 * 14
    # "redis" in deployment; "memory" for pytest / local profile / single-process.
    session_backend: str = "redis"

    cors_origins: list[str] = ["http://localhost:5173"]

    crypto_protocol_version: int = 1
    webauthn_rp_id: str = "localhost"
    webauthn_challenge_ttl_seconds: int = 120
    webauthn_challenge_rate_limit: int = 20
    webauthn_challenge_rate_window_seconds: int = 60

    auth_min_password_length: int = 12
    auth_login_rate_limit: int = 10
    auth_login_rate_window_seconds: int = 60
    # Snapshot writes, device create, credential metadata. Separate from login
    # so a write burst cannot lock an account out of authentication.
    write_rate_limit: int = 30
    write_rate_window_seconds: int = 60

    def session_secret_is_insecure_default(self) -> bool:
        return self.session_secret in {"", "change-me-in-production"}

    def is_local(self) -> bool:
        return self.profile == "local"


@lru_cache
def get_settings() -> Settings:
    return Settings()
