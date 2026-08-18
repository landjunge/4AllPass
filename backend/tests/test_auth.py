import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.user import User

pytestmark = pytest.mark.asyncio(loop_scope="session")
settings = get_settings()


async def test_register_success(client: AsyncClient):
    response = await client.post(
        "/auth/register",
        json={"email": "alice@example.com", "password": "SuperSecretPassword123!"},
    )
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "alice@example.com"
    assert data["is_active"] is True
    assert "id" in data
    assert "created_at" in data
    # Security: Ensure no password hash or secrets are returned in response
    assert "password" not in data
    assert "account_password_hash" not in data
    assert "session_token" not in data

    # Ensure session cookie was set
    assert settings.session_cookie_name in response.cookies
    session_cookie = response.cookies[settings.session_cookie_name]
    assert len(session_cookie) > 20


async def test_register_duplicate_email(client: AsyncClient):
    await client.post(
        "/auth/register",
        json={"email": "duplicate@example.com", "password": "Password123!"},
    )
    response = await client.post(
        "/auth/register",
        json={"email": "duplicate@example.com", "password": "Password123!"},
    )
    assert response.status_code == 400
    assert "already registered" in response.json()["detail"].lower()


async def test_register_case_insensitive_normalization(client: AsyncClient):
    res1 = await client.post(
        "/auth/register",
        json={"email": "CaseTest@Example.COM", "password": "Password123!"},
    )
    assert res1.status_code == 201
    assert res1.json()["email"] == "casetest@example.com"

    res2 = await client.post(
        "/auth/register",
        json={"email": "casetest@example.com", "password": "Password123!"},
    )
    assert res2.status_code == 400


async def test_register_invalid_payloads(client: AsyncClient):
    # Short password (< 8 chars)
    res_short = await client.post(
        "/auth/register",
        json={"email": "short@example.com", "password": "123"},
    )
    assert res_short.status_code == 422

    # Invalid email
    res_email = await client.post(
        "/auth/register",
        json={"email": "not-an-email", "password": "Password123!"},
    )
    assert res_email.status_code == 422


async def test_login_success(client: AsyncClient):
    # Register first
    await client.post(
        "/auth/register",
        json={"email": "bob@example.com", "password": "BobSecurePassword456!"},
    )

    # Login
    response = await client.post(
        "/auth/login",
        json={"email": "bob@example.com", "password": "BobSecurePassword456!"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "bob@example.com"
    assert "account_password_hash" not in data
    assert settings.session_cookie_name in response.cookies


async def test_login_wrong_password(client: AsyncClient):
    await client.post(
        "/auth/register",
        json={"email": "wrongpwd@example.com", "password": "CorrectPassword123!"},
    )

    response = await client.post(
        "/auth/login",
        json={"email": "wrongpwd@example.com", "password": "WrongPassword123!"},
    )
    assert response.status_code == 401
    assert "invalid email or password" in response.json()["detail"].lower()


async def test_login_nonexistent_user(client: AsyncClient):
    response = await client.post(
        "/auth/login",
        json={"email": "nobody@example.com", "password": "RandomPassword123!"},
    )
    assert response.status_code == 401
    assert "invalid email or password" in response.json()["detail"].lower()


async def test_login_inactive_user(client: AsyncClient, db_session: AsyncSession):
    # Register user
    reg = await client.post(
        "/auth/register",
        json={"email": "inactive@example.com", "password": "Password123!"},
    )
    user_id = uuid.UUID(reg.json()["id"])

    # Mark user inactive
    user = await db_session.get(User, user_id)
    assert user is not None
    user.is_active = False
    await db_session.commit()

    # Attempt login
    response = await client.post(
        "/auth/login",
        json={"email": "inactive@example.com", "password": "Password123!"},
    )
    assert response.status_code == 401
    assert "inactive" in response.json()["detail"].lower()


async def test_logout_and_session_invalidation(client: AsyncClient):
    # Register and get session
    reg = await client.post(
        "/auth/register",
        json={"email": "logout_test@example.com", "password": "Password123!"},
    )
    session_token = reg.cookies[settings.session_cookie_name]

    # Verify /auth/me works with cookie
    client.cookies.set(settings.session_cookie_name, session_token)
    me_resp = await client.get("/auth/me")
    assert me_resp.status_code == 200

    # Logout
    logout_resp = await client.post("/auth/logout")
    assert logout_resp.status_code == 200

    # Cookie should be cleared and subsequent /auth/me must fail (401)
    client.cookies.delete(settings.session_cookie_name)
    me_after = await client.get("/auth/me")
    assert me_after.status_code == 401

    # Manually attempting to use the old revoked session token should also fail (401)
    client.cookies.set(settings.session_cookie_name, session_token)
    me_revoked = await client.get("/auth/me")
    assert me_revoked.status_code == 401
    assert "invalid or expired session" in me_revoked.json()["detail"].lower()


async def test_auth_me_unauthenticated(client: AsyncClient):
    client.cookies.clear()
    response = await client.get("/auth/me")
    assert response.status_code == 401
    assert "not authenticated" in response.json()["detail"].lower()


async def test_bearer_token_authentication(client: AsyncClient):
    reg = await client.post(
        "/auth/register",
        json={"email": "bearer@example.com", "password": "Password123!"},
    )
    session_token = reg.cookies[settings.session_cookie_name]

    # Clear cookies on client
    client.cookies.clear()

    # Request /auth/me with Bearer authorization header
    response = await client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert response.status_code == 200
    assert response.json()["email"] == "bearer@example.com"
