import logging
import uuid

import pytest

from app.core.sessions import get_session_store
from tests.conftest import SESSION_COOKIE, use_session

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASSWORD = "account-password-1234"


def _email() -> str:
    return f"user-{uuid.uuid4().hex[:10]}@example.com"


def _session_token(response) -> str:
    token = response.cookies.get(SESSION_COOKIE)
    assert token, f"missing session cookie: {response.headers.get('set-cookie')}"
    return token


def _assert_account_body(body: dict, email: str) -> None:
    assert body["email"] == email
    assert body["id"]
    assert body["createdAt"]
    assert "token" not in body
    assert "expiresIn" not in body
    assert "accountPasswordHash" not in body
    assert "password" not in body


async def test_register_login_me_logout(client):
    email = _email()
    register = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert register.status_code == 200, register.text
    _assert_account_body(register.json(), email)

    set_cookie = register.headers["set-cookie"]
    assert "HttpOnly" in set_cookie
    assert "samesite=lax" in set_cookie.lower()
    first_token = _session_token(register)

    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    _assert_account_body(me.json(), email)

    login = await client.post("/api/v1/auth/login", json={"email": email.upper(), "password": PASSWORD})
    assert login.status_code == 200
    _assert_account_body(login.json(), email)
    second_token = _session_token(login)
    assert second_token != first_token

    # Previous session is revoked (session fixation / reuse after re-login).
    stale = await use_session(client, first_token).get("/api/v1/auth/me")
    assert stale.status_code == 401

    logout = await use_session(client, second_token).post("/api/v1/auth/logout")
    assert logout.status_code == 204

    after = await use_session(client, second_token).get("/api/v1/auth/me")
    assert after.status_code == 401


async def test_login_wrong_password(client):
    email = _email()
    await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    client.cookies.clear()
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "definitely-wrong-password"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid credentials"
    assert SESSION_COOKIE not in response.cookies


async def test_register_duplicate_email(client):
    email = _email()
    first = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert first.status_code == 200
    client.cookies.clear()
    second = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert second.status_code == 409


async def test_me_without_session(client):
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401


async def test_invalid_session_cookie(client):
    response = await use_session(client, "not-a-real-session").get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "not authenticated"


async def test_expired_session(client):
    email = _email()
    register = await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    token = _session_token(register)
    store = get_session_store()
    record = await store.get(token)
    assert record is not None
    await store.put(token, record, ttl_seconds=-1)

    response = await use_session(client, token).get("/api/v1/auth/me")
    assert response.status_code == 401


async def test_register_rejects_short_password(client):
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": _email(), "password": "short"},
    )
    assert response.status_code == 422


async def test_register_rejects_mass_assignment(client):
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": _email(),
            "password": PASSWORD,
            "isActive": False,
            "accountPasswordHash": "x",
            "userId": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 422


async def test_forged_user_id_header_does_not_authenticate(client):
    forged = str(uuid.uuid4())
    response = await client.get(
        "/api/v1/auth/me",
        headers={"X-User-Id": forged, "User-Id": forged},
        params={"user_id": forged},
    )
    assert response.status_code == 401


async def test_login_does_not_log_password(client, caplog):
    email = _email()
    await client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    client.cookies.clear()
    with caplog.at_level(logging.DEBUG):
        await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    combined = " ".join(record.getMessage() for record in caplog.records)
    assert PASSWORD not in combined
    assert "fourallpass_session=" not in combined
