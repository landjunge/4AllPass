"""Authentication endpoint tests: register / login / logout / me,
session lifecycle, and secret-leakage checks."""

import logging

import pytest
from redis.asyncio import Redis

from app.core.config import get_settings
from tests.conftest import make_api_client, register_and_login, unique_email

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASSWORD = "correct horse battery"
COOKIE = get_settings().session_cookie_name


async def _session_redis_keys() -> list[str]:
    redis = Redis.from_url(get_settings().redis_url, decode_responses=True)
    try:
        return [key async for key in redis.scan_iter("session:*")]
    finally:
        await redis.aclose()


async def test_register_success(api_client):
    email = unique_email()
    response = await api_client.post(
        "/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == email
    assert set(body.keys()) == {"id", "email", "created_at"}
    # Registering alone must not establish a session.
    assert COOKIE not in response.cookies


async def test_register_duplicate_email(api_client):
    email = unique_email()
    first = await api_client.post("/auth/register", json={"email": email, "password": PASSWORD})
    assert first.status_code == 201
    duplicate = await api_client.post(
        "/auth/register", json={"email": email.upper(), "password": "another password 1"}
    )
    assert duplicate.status_code == 409


async def test_register_rejects_invalid_input(api_client):
    bad_email = await api_client.post(
        "/auth/register", json={"email": "not-an-email", "password": PASSWORD}
    )
    assert bad_email.status_code == 422

    short_password = await api_client.post(
        "/auth/register", json={"email": unique_email(), "password": "short"}
    )
    assert short_password.status_code == 422


async def test_login_success_sets_httponly_cookie(api_client):
    email = unique_email()
    await api_client.post("/auth/register", json={"email": email, "password": PASSWORD})
    response = await api_client.post("/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200
    assert set(response.json().keys()) == {"id", "email", "created_at"}

    set_cookie = response.headers["set-cookie"]
    assert COOKIE in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie
    assert "Path=/" in set_cookie
    # The session token must never appear in the response body.
    assert response.cookies[COOKIE] not in response.text


async def test_login_failure_wrong_password_and_unknown_email(api_client):
    email = unique_email()
    await api_client.post("/auth/register", json={"email": email, "password": PASSWORD})

    wrong = await api_client.post("/auth/login", json={"email": email, "password": "wrong pass"})
    unknown = await api_client.post(
        "/auth/login", json={"email": unique_email(), "password": PASSWORD}
    )
    assert wrong.status_code == 401
    assert unknown.status_code == 401
    # Identical response bodies: no user-enumeration signal.
    assert wrong.json() == unknown.json()
    assert COOKIE not in wrong.cookies
    assert COOKIE not in unknown.cookies


async def test_me_requires_session(api_client):
    unauthenticated = await api_client.get("/auth/me")
    assert unauthenticated.status_code == 401


async def test_me_returns_current_user(engine):
    async with make_api_client() as client:
        user = await register_and_login(client)
        response = await client.get("/auth/me")
        assert response.status_code == 200
        assert response.json()["id"] == user["id"]
        assert set(response.json().keys()) == {"id", "email", "created_at"}


async def test_garbage_session_cookie_rejected(engine):
    async with make_api_client() as client:
        client.cookies.set(COOKIE, "A" * 43)
        response = await client.get("/auth/me")
        assert response.status_code == 401


async def test_logout_revokes_session_server_side(engine):
    async with make_api_client() as client:
        await register_and_login(client)
        token = client.cookies[COOKIE]

        logout = await client.post("/auth/logout")
        assert logout.status_code == 204

        # Reusing the *old* token after logout must fail even if the client
        # kept a copy (server-side revocation, not just cookie deletion).
        client.cookies.set(COOKIE, token)
        reuse = await client.get("/auth/me")
        assert reuse.status_code == 401


async def test_expired_or_deleted_session_rejected(engine):
    async with make_api_client() as client:
        await register_and_login(client)
        assert (await client.get("/auth/me")).status_code == 200

        # Simulate TTL expiry: an expired Redis key is a removed key.
        redis = Redis.from_url(get_settings().redis_url, decode_responses=True)
        try:
            async for key in redis.scan_iter("session:*"):
                await redis.delete(key)
        finally:
            await redis.aclose()

        assert (await client.get("/auth/me")).status_code == 401


async def test_sessions_are_stored_hashed_with_ttl(engine):
    async with make_api_client() as client:
        await register_and_login(client)
        token = client.cookies[COOKIE]

        redis = Redis.from_url(get_settings().redis_url, decode_responses=True)
        try:
            keys = [key async for key in redis.scan_iter("session:*")]
            assert keys, "expected at least one stored session"
            # The raw token never appears in Redis keys (only its SHA-256).
            assert all(token not in key for key in keys)
            ttls = [await redis.ttl(key) for key in keys]
        finally:
            await redis.aclose()
        assert all(0 < ttl <= get_settings().session_ttl_seconds for ttl in ttls)


async def test_no_password_or_token_in_logs(engine, caplog):
    with caplog.at_level(logging.DEBUG):
        async with make_api_client() as client:
            user = await register_and_login(client)
            token = client.cookies[COOKIE]
            await client.get("/auth/me")
            await client.post("/auth/logout")

    assert user["password"] not in caplog.text
    assert token not in caplog.text
