import uuid

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")
COOKIE_NAME = "4allpass_session"


def _email() -> str:
    return f"user-{uuid.uuid4().hex[:10]}@example.com"


async def test_register_login_me_logout(client):
    email = _email()
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "account-password-1234"},
    )
    assert register.status_code == 200, register.text
    body = register.json()
    assert body["accountId"]
    assert body["email"] == email
    assert "token" not in body
    assert body["expiresIn"] > 0
    registered_token = register.cookies[COOKIE_NAME]
    set_cookie = register.headers["set-cookie"].lower()
    assert "httponly" in set_cookie
    assert "samesite=strict" in set_cookie
    assert "path=/api/v1" in set_cookie

    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == email

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": email.upper(), "password": "account-password-1234"},
    )
    assert login.status_code == 200
    token = login.cookies[COOKIE_NAME]
    assert token != registered_token
    assert "token" not in login.json()

    logout = await client.post("/api/v1/auth/logout")
    assert logout.status_code == 204

    after = await client.get(
        "/api/v1/auth/me",
        headers={"Cookie": f"{COOKIE_NAME}={token}"},
    )
    assert after.status_code == 401


async def test_login_wrong_password(client):
    email = _email()
    await client.post("/api/v1/auth/register", json={"email": email, "password": "account-password-1234"})
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "definitely-wrong-password"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid credentials"


async def test_register_duplicate_email(client):
    email = _email()
    first = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": "account-password-1234"}
    )
    assert first.status_code == 200
    second = await client.post(
        "/api/v1/auth/register", json={"email": email, "password": "account-password-1234"}
    )
    assert second.status_code == 409


async def test_me_without_token(client):
    client.cookies.clear()
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401


async def test_invalid_session_cookie_is_rejected(client):
    response = await client.get(
        "/api/v1/auth/me",
        headers={"Cookie": f"{COOKIE_NAME}=not-a-valid-session"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid or expired session"


async def test_register_rejects_short_password(client):
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": _email(), "password": "short"},
    )
    assert response.status_code == 422


async def test_auth_response_and_logs_do_not_expose_credentials(client, caplog):
    password = f"secret-{uuid.uuid4().hex}-password"
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": _email(), "password": password},
    )
    assert response.status_code == 200
    assert password not in response.text
    assert password not in caplog.text
    assert "account_password_hash" not in response.text
    assert "token" not in response.json()
