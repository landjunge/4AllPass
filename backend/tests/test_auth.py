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


async def test_invalid_and_expired_sessions_are_rejected(client):
    client.cookies.clear()
    invalid = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-session"})
    assert invalid.status_code == 401

    from app.core.security import new_session_token
    from app.core.sessions import SessionRecord, get_session_store

    token = new_session_token()
    await get_session_store().put(
        token,
        SessionRecord(user_id=uuid.uuid4(), email="expired@example.com", csrf_token="csrf"),
        ttl_seconds=0,
    )
    expired = await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert expired.status_code == 401


async def test_concurrent_sessions_survive_second_login(client):
    email = _email()
    first = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "account-password-1234"},
    )
    first_token = first.cookies["4allpass_session"]
    second = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "account-password-1234"},
    )
    assert second.status_code == 200
    still_valid = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {first_token}"},
    )
    assert still_valid.status_code == 200
    assert still_valid.json()["email"] == email


async def test_bearer_writes_do_not_need_csrf(client):
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": _email(), "password": "account-password-1234"},
    )
    token = register.cookies["4allpass_session"]
    client.cookies.clear()
    created = await client.post(
        "/api/v1/vaults",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert created.status_code == 201


async def test_me_never_returns_password_hash(client):
    email = _email()
    await client.post("/api/v1/auth/register", json={"email": email, "password": "account-password-1234"})
    me = await client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert "accountPasswordHash" not in me.json()
    assert "password" not in me.json()


async def test_register_rejects_mass_assignment(client):
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": _email(),
            "password": "account-password-1234",
            "isAdmin": True,
            "ownerUserId": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 422
