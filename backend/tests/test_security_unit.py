from uuid import uuid4

import pytest

from app.core.security import hash_account_password, new_session_token, token_lookup_key, verify_account_password
from app.core.sessions import MemorySessionStore, SessionRecord


def test_account_password_is_not_reversible():
    hashed = hash_account_password("account-password-1234")
    assert hashed != "account-password-1234"
    assert hashed.startswith("$argon2id$")
    assert verify_account_password("account-password-1234", hashed)
    assert not verify_account_password("wrong-password-1234", hashed)


def test_token_lookup_is_not_the_bearer_token():
    token = new_session_token()
    assert token_lookup_key(token) != token
    assert len(token_lookup_key(token)) == 64


async def test_memory_session_roundtrip_and_delete():
    store = MemorySessionStore()
    token = new_session_token()
    record = SessionRecord(user_id=uuid4(), email="a@example.com", device_id="dev_aaaaaaaaaaaaaaaaaaaaaaaa")
    await store.put(token, record, ttl_seconds=60)
    loaded = await store.get(token)
    assert loaded is not None
    assert loaded.email == "a@example.com"
    assert loaded.device_id == "dev_aaaaaaaaaaaaaaaaaaaaaaaa"
    await store.delete(token)
    assert await store.get(token) is None


async def test_revoke_device_keeps_the_calling_token():
    store = MemorySessionStore()
    user_id = uuid4()
    keep = new_session_token()
    other = new_session_token()
    foreign = new_session_token()
    await store.put(keep, SessionRecord(user_id=user_id, email="a@example.com", device_id="dev_aaaaaaaaaaaaaaaaaaaaaaaa"), 60)
    await store.put(other, SessionRecord(user_id=user_id, email="a@example.com", device_id="dev_aaaaaaaaaaaaaaaaaaaaaaaa"), 60)
    await store.put(foreign, SessionRecord(user_id=user_id, email="a@example.com", device_id="dev_bbbbbbbbbbbbbbbbbbbbbbbb"), 60)
    removed = await store.revoke_device(user_id, "dev_aaaaaaaaaaaaaaaaaaaaaaaa", keep_token=keep)
    assert removed == 1
    assert await store.get(keep) is not None
    assert await store.get(other) is None
    assert await store.get(foreign) is not None


async def test_rate_limit_trips():
    store = MemorySessionStore()
    for _ in range(10):
        assert await store.hit_rate_limit("login:1.2.3.4", limit=10, window_seconds=60) is False
    assert await store.hit_rate_limit("login:1.2.3.4", limit=10, window_seconds=60) is True


def test_production_refuses_default_session_secret(monkeypatch):
    from app.core.config import get_settings
    from app.main import create_app

    monkeypatch.setenv("FOURALLPASS_ENVIRONMENT", "production")
    monkeypatch.setenv("FOURALLPASS_SESSION_SECRET", "change-me-in-production")
    get_settings.cache_clear()
    with pytest.raises(RuntimeError, match="SESSION_SECRET"):
        create_app()
    get_settings.cache_clear()
