from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Server configuration. Nothing here can decrypt a vault."""

    model_config = SettingsConfigDict(
        env_prefix="FOURALLPASS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    api_prefix: str = "/api/v1"

    database_url: str = "postgresql+asyncpg://4allpass:4allpass@localhost:5432/4allpass"
    database_echo: bool = False
    database_pool_size: int = 10

    redis_url: str = "redis://localhost:6379/0"

    session_ttl_seconds: int = 60 * 60 * 12
    session_cookie_name: str = "4allpass_session"
    login_attempts_per_minute: int = 10

    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    webauthn_rp_id: str = "localhost"
    webauthn_rp_name: str = "4AllPass"

    max_entries_per_snapshot: int = 20_000
    max_entry_ciphertext_bytes: int = 256 * 1024
    max_device_envelopes_per_snapshot: int = 200

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def sync_database_url(self) -> str:
        """Alembic runs migrations synchronously, over psycopg."""
        return self.database_url.replace("+asyncpg", "+psycopg")


@lru_cache
def get_settings() -> Settings:
    return Settings()
