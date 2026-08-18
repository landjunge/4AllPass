from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SESSION_SECRET = "change-me-in-production"
MIN_PRODUCTION_SESSION_SECRET_LENGTH = 32


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
    # `session_secret` keys the HMAC that turns a bearer token into its storage
    # lookup key, so a leaked Redis dump cannot be replayed as credentials.
    session_secret: str = DEFAULT_SESSION_SECRET
    session_ttl_seconds: int = 60 * 60 * 24 * 14
    # "redis" in deployment; "memory" for pytest / single-process dev without Redis.
    session_backend: str = "redis"

    # Browser sessions ride an HttpOnly cookie; see docs/backend-security.md §3.
    session_cookie_name: str = "4allpass_session"
    csrf_cookie_name: str = "4allpass_csrf"
    session_cookie_path: str = "/"
    session_cookie_domain: str | None = None
    session_cookie_samesite: Literal["strict", "lax", "none"] = "strict"
    # None => derive from `environment`, so a production deploy is Secure-only
    # without extra configuration and a plain-HTTP dev box still works.
    session_cookie_secure: bool | None = None

    cors_origins: list[str] = ["http://localhost:5173"]

    crypto_protocol_version: int = 1
    webauthn_rp_id: str = "localhost"

    auth_min_password_length: int = 12
    auth_login_rate_limit: int = 10
    auth_login_rate_window_seconds: int = 60

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() == "production"

    @property
    def cookies_require_secure(self) -> bool:
        if self.session_cookie_secure is not None:
            return self.session_cookie_secure
        return self.is_production

    @model_validator(mode="after")
    def _reject_insecure_production_config(self) -> "Settings":
        """Refuse to boot a production instance with placeholder auth config.

        Failing at startup is the point. A server that silently runs on the
        published default secret lets anyone who reads this repository mint
        session lookup keys, which is an authentication bypass — and it would
        otherwise stay invisible until someone used it.
        """
        if not self.is_production:
            return self

        problems: list[str] = []
        if self.session_secret == DEFAULT_SESSION_SECRET:
            problems.append("FOURALLPASS_SESSION_SECRET is still the built-in default")
        elif len(self.session_secret) < MIN_PRODUCTION_SESSION_SECRET_LENGTH:
            problems.append(
                "FOURALLPASS_SESSION_SECRET must be at least "
                f"{MIN_PRODUCTION_SESSION_SECRET_LENGTH} characters"
            )
        if self.debug:
            problems.append("FOURALLPASS_DEBUG must be false in production")
        if self.session_cookie_samesite == "none" and not self.cookies_require_secure:
            problems.append("SameSite=None cookies require FOURALLPASS_SESSION_COOKIE_SECURE=true")

        if problems:
            raise ValueError("insecure production configuration: " + "; ".join(problems))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
