from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FOURALLPASS_", extra="ignore")

    database_url: str = "postgresql+psycopg://fourallpass:fourallpass@127.0.0.1:5432/fourallpass"
    redis_url: str = "redis://127.0.0.1:6379/0"


settings = Settings()
