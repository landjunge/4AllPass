import uuid

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _email() -> str:
    return f"user-{uuid.uuid4().hex[:10]}@example.com"


def _csrf(client) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies["4allpass_csrf"]}


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
    assert body["expiresIn"] > 0
    assert body["expiresAt"]
    assert "token" not in body
    assert register.cookies["4allpass_session"]
    assert "HttpOnly" in register.headers["set-cookie"]
    assert "SameSite=lax" in register.headers["set-cookie"]

    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == email

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": email.upper(), "password": "account-password-1234"},
    )
    assert login.status_code == 200
    first_token = register.cookies["4allpass_session"]
    token = login.cookies["4allpass_session"]
    assert token != first_token

    logout = await client.post("/api/v1/auth/logout", headers=_csrf(client))
    assert logout.status_code == 204

    after = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
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


async def test_register_rejects_short_password(client):
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": _email(), "password": "short"},
    )
    assert response.status_code == 422


async def test_cookie_authenticated_write_requires_csrf(client):
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": _email(), "password": "account-password-1234"},
    )
    assert response.status_code == 200

    rejected = await client.post("/api/v1/vaults")
    assert rejected.status_code == 403

    accepted = await client.post("/api/v1/vaults", headers=_csrf(client))
    assert accepted.status_code == 201
