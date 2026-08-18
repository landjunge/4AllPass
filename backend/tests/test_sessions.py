import time
import uuid

import pytest

from app.core.security import new_session_token, token_lookup_key
from app.core.sessions import MemorySessionStore, SessionRecord
from tests.helpers import PASSWORD, auth, signup

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_invalid_token_is_rejected(client):
    response = await client.get("/api/v1/auth/me", headers=auth("not-a-real-token"))
    assert response.status_code == 401
    assert "token" not in response.text.lower() or "invalid" in response.json()["detail"]


async def test_malformed_authorization_header(client):
    response = await client.get("/api/v1/auth/me", headers={"Authorization": "Token abc"})
    assert response.status_code == 401


async def test_logout_revokes_token_and_reuse_fails(client):
    _, token = await signup(client)
    assert (await client.get("/api/v1/auth/me", headers=auth(token))).status_code == 200
    logout = await client.post("/api/v1/auth/logout", headers=auth(token))
    assert logout.status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=auth(token))).status_code == 401
    again = await client.post("/api/v1/auth/logout", headers=auth(token))
    assert again.status_code == 204


async def test_concurrent_sessions_are_independent(client):
    email, first = await signup(client)
    login = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": PASSWORD},
    )
    assert login.status_code == 200
    second = login.json()["token"]
    assert first != second
    assert (await client.get("/api/v1/auth/me", headers=auth(first))).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=auth(second))).status_code == 200
    await client.post("/api/v1/auth/logout", headers=auth(first))
    assert (await client.get("/api/v1/auth/me", headers=auth(first))).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=auth(second))).status_code == 200


async def test_expired_session_is_rejected():
    store = MemorySessionStore()
    token = new_session_token()
    await store.put(token, SessionRecord(user_id=uuid.uuid4(), email="a@example.com"), ttl_seconds=0)
    time.sleep(0.01)
    assert await store.get(token) is None


async def test_session_store_never_keys_on_raw_token():
    store = MemorySessionStore()
    token = new_session_token()
    await store.put(token, SessionRecord(user_id=uuid.uuid4(), email="a@example.com"), ttl_seconds=60)
    assert token not in store._sessions
    assert token_lookup_key(token) in store._sessions


async def test_login_rate_limit_returns_429(client, monkeypatch):
    from app.core.config import get_settings
    from app.core.sessions import get_session_store

    settings = get_settings()
    monkeypatch.setattr(settings, "auth_login_rate_limit", 2)
    store = get_session_store()
    if hasattr(store, "_rates"):
        store._rates.clear()
    email = f"rl-{uuid.uuid4().hex[:8]}@example.com"
    await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    first = await client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password-xx"})
    second = await client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password-xx"})
    third = await client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password-xx"})
    assert first.status_code == 401
    assert second.status_code == 401
    assert third.status_code == 429


async def test_me_never_returns_password_hash_or_token(client):
    email, token = await signup(client)
    me = await client.get("/api/v1/auth/me", headers=auth(token))
    assert me.status_code == 200
    body = me.json()
    assert body["email"] == email
    assert "token" not in body
    assert "password" not in body
    assert "accountPasswordHash" not in body
    assert "account_password_hash" not in body
    dumped = me.text.lower()
    assert "$argon2" not in dumped
    assert token not in me.text
