from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FOURALLPASS_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://fourallpass:fourallpass@localhost:5432/fourallpass"
    redis_url: str = "redis://localhost:6379/0"

    # WebAuthn relying party. rp_id must stay stable for the life of the
    # vault's device credentials (docs/webauthn-prf.md §7).
    rp_id: str = "localhost"
    rp_name: str = "4AllPass"

    webauthn_challenge_ttl_seconds: int = 300

    crypto_protocol_version: int = 1


@lru_cache
def get_settings() -> Settings:
    return Settings()
