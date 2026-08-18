import uuid

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _email() -> str:
    return f"user-{uuid.uuid4().hex[:10]}@example.test"


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
    assert body["token"]
    assert body["expiresIn"] > 0

    me = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200
    assert me.json()["email"] == email

    login = await client.post(
        "/api/v1/auth/login",
        json={"email": email.upper(), "password": "account-password-1234"},
    )
    assert login.status_code == 200
    token = login.json()["token"]
    assert token != body["token"]

    logout = await client.post("/api/v1/auth/logout", headers={"Authorization": f"Bearer {token}"})
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
    response = await client.get("/api/v1/auth/me")
    assert response.status_code == 401


async def test_register_rejects_short_password(client):
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": _email(), "password": "short"},
    )
    assert response.status_code == 422
