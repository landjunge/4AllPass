import os

os.environ.setdefault(
    "FOURALLPASS_DATABASE_URL",
    "postgresql+psycopg://fourallpass:fourallpass@localhost:5432/fourallpass_test",
)
os.environ.setdefault("FOURALLPASS_REDIS_URL", "redis://localhost:6379/1")

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db.base import get_engine, get_session_factory
from app.main import app

API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    cfg = Config(os.path.join(API_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(API_DIR, "alembic"))
    cfg.set_main_option("sqlalchemy.url", os.environ["FOURALLPASS_DATABASE_URL"])
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean_tables(migrated_database):
    yield
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE users, vaults, devices, vault_snapshots, key_envelopes, "
                "vault_entries, webauthn_credentials, device_key_envelopes CASCADE"
            )
        )


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    session = get_session_factory()()
    yield session
    session.close()
