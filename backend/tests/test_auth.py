from httpx import AsyncClient

from tests.conftest import Api


async def test_register_creates_session_and_account(anonymous: Api) -> None:
    response = await anonymous.register("New.User@Example.com ".strip())
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "new.user@example.com"
    assert body["expiresIn"] > 0

    me = await anonymous.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == "new.user@example.com"


async def test_duplicate_email_is_rejected(anonymous: Api) -> None:
    assert (await anonymous.register("dup@example.com")).status_code == 201
    again = await anonymous.register("dup@example.com")
    assert again.status_code == 409


async def test_login_and_logout(anonymous: Api) -> None:
    await anonymous.register("login@example.com", password="correct-horse-battery")
    logout = await anonymous.post("/auth/logout")
    assert logout.status_code == 204
    assert (await anonymous.get("/auth/me")).status_code == 401

    assert (await anonymous.login("login@example.com", "wrong-password-here")).status_code == 401
    assert (await anonymous.login("login@example.com", "correct-horse-battery")).status_code == 200
    assert (await anonymous.get("/auth/me")).status_code == 200


async def test_unknown_account_and_missing_token(
    anonymous: Api, client: AsyncClient, api: str
) -> None:
    assert (await anonymous.login("nobody@example.com", "correct-horse-battery")).status_code == 401
    assert (await client.get(f"{api}/auth/me")).status_code == 401


async def test_login_is_rate_limited(anonymous: Api) -> None:
    await anonymous.register("limited@example.com", password="correct-horse-battery")
    statuses = [
        (await anonymous.login("limited@example.com", "wrong-password-here")).status_code
        for _ in range(12)
    ]
    assert 429 in statuses


async def test_password_hash_is_never_returned(anonymous: Api) -> None:
    await anonymous.register("hash@example.com")
    me = await anonymous.get("/auth/me")
    assert "password" not in me.text.lower()
