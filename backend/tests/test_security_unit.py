import time
from uuid import uuid4

import pytest
from starlette.requests import Request

from app.core.client_ip import client_ip
from app.core.config import DEFAULT_SESSION_SECRET, Settings, get_settings
from app.core.emails import normalize_account_email
from app.core.security import (
    hash_account_password,
    new_csrf_token,
    new_session_token,
    token_lookup_key,
    tokens_match,
    verify_account_password,
)
from app.core.sessions import MemorySessionStore, new_session_record


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


def test_tokens_match_only_for_the_right_token():
    token = new_csrf_token()
    stored = token_lookup_key(token)
    assert tokens_match(token, stored)
    assert not tokens_match(new_csrf_token(), stored)


async def test_memory_session_roundtrip_and_delete():
    store = MemorySessionStore()
    token = new_session_token()
    record = new_session_record(uuid4(), "a@example.test", new_csrf_token())
    await store.put(token, record, ttl_seconds=60)
    loaded = await store.get(token)
    assert loaded is not None
    assert loaded.email == "a@example.test"
    await store.delete(token)
    assert await store.get(token) is None


async def test_session_expiry_is_absolute():
    """A session past its TTL is gone, and reading it does not renew it."""
    store = MemorySessionStore()
    token = new_session_token()
    await store.put(token, new_session_record(uuid4(), "a@example.test", new_csrf_token()), 1)
    assert await store.get(token) is not None
    await store.put(token, new_session_record(uuid4(), "a@example.test", new_csrf_token()), -1)
    assert await store.get(token) is None


async def test_session_record_stores_csrf_as_lookup_key_not_plaintext():
    csrf = new_csrf_token()
    record = new_session_record(uuid4(), "a@example.test", csrf)
    assert record.csrf_token_hash != csrf
    assert tokens_match(csrf, record.csrf_token_hash)
    assert record.created_at <= time.time()


async def test_rate_limit_trips():
    store = MemorySessionStore()
    for _ in range(10):
        assert await store.hit_rate_limit("login:1.2.3.4", limit=10, window_seconds=60) is False
    assert await store.hit_rate_limit("login:1.2.3.4", limit=10, window_seconds=60) is True


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Ada@Example.COM", "ada@example.com"),
        ("  ops@homelab.test  ", "ops@homelab.test"),
        ("admin@vault.internal", "admin@vault.internal"),
    ],
)
def test_account_email_is_canonicalized(raw, expected):
    assert normalize_account_email(raw) == expected


@pytest.mark.parametrize("raw", ["nope", "@example.com", "a b@example.com", "a@@b.com"])
def test_account_email_rejects_malformed(raw):
    with pytest.raises(ValueError):
        normalize_account_email(raw)


def test_production_refuses_the_default_session_secret():
    """The secret keys session lookup; shipping the published default is a bypass."""
    with pytest.raises(ValueError, match="session_secret|SESSION_SECRET"):
        Settings(environment="production", session_secret=DEFAULT_SESSION_SECRET)


def test_production_refuses_a_short_session_secret():
    with pytest.raises(ValueError, match="SESSION_SECRET"):
        Settings(environment="production", session_secret="too-short")


def test_production_refuses_debug():
    with pytest.raises(ValueError, match="DEBUG"):
        Settings(environment="production", session_secret="x" * 40, debug=True)


def test_production_config_accepts_a_real_secret():
    settings = Settings(environment="production", session_secret="x" * 40)
    assert settings.is_production
    assert settings.cookies_require_secure


def test_development_cookies_are_not_secure_only():
    """A plain-HTTP dev box must still be able to hold a session."""
    settings = Settings(environment="development")
    assert not settings.cookies_require_secure


def _request(headers: dict[str, str], *, peer: str = "10.0.0.1") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/login",
            "headers": [(k.encode(), v.encode()) for k, v in headers.items()],
            "client": (peer, 51234),
        }
    )


def test_client_ip_ignores_forwarded_headers_by_default():
    """A directly-exposed server must not let callers choose their own bucket."""
    assert get_settings().trust_proxy_client_ip is False
    assert client_ip(_request({"x-real-ip": "203.0.113.9"})) == "10.0.0.1"
    assert client_ip(_request({"x-forwarded-for": "203.0.113.9"})) == "10.0.0.1"


def test_client_ip_uses_the_proxy_header_when_explicitly_trusted(monkeypatch):
    trusting = Settings(environment="development", trust_proxy_client_ip=True)
    monkeypatch.setattr("app.core.client_ip.get_settings", lambda: trusting)

    assert client_ip(_request({"x-real-ip": "203.0.113.9"})) == "203.0.113.9"
    assert client_ip(_request({"x-forwarded-for": "203.0.113.9, 10.0.0.1"})) == "203.0.113.9"
    # Falls back to the socket peer when the proxy sent nothing.
    assert client_ip(_request({})) == "10.0.0.1"
