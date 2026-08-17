import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.db import Base
from app.models import (  # noqa: F401 — register mappers
    Account,
    Device,
    OAuthIdentity,
    SnapshotEnvelope,
    SnapshotEntry,
    Vault,
    VaultSnapshot,
    WebAuthnCredential,
)


@pytest.fixture
def session() -> Session:
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def _fk(dbapi_connection, _connection_record) -> None:  # type: ignore[no-untyped-def]
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    db = factory()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()
