"""Small helpers shared by the auth / authorization tests."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from httpx import AsyncClient

from app.core.config import get_settings

DEFAULT_PASSWORD = "correct-horse-battery-staple"

SESSION_COOKIE_NAME = get_settings().session_cookie_name
TEST_HOST = "testserver.local"


def plant_session_cookie(client: AsyncClient, value: str) -> None:
    """Put a session token into a client's cookie jar as a browser would.

    The domain has to match the one the server's own ``Set-Cookie`` lands
    under, otherwise the jar keeps both and the client sends two cookies of the
    same name — which is not what any of these tests mean to simulate.
    """
    client.cookies.set(SESSION_COOKIE_NAME, value, domain=TEST_HOST, path="/")


def unique_email() -> str:
    # `example.com` rather than `example.test`: account e-mails go through
    # `EmailStr`, which rejects special-use domains (`.test`, `.local`,
    # `.invalid`). See tests/test_auth.py for the test that pins that.
    return f"user-{uuid.uuid4().hex[:12]}@example.com"


@dataclass(frozen=True)
class Account:
    email: str
    password: str
    user_id: str


async def register(
    client: AsyncClient, *, email: str | None = None, password: str = DEFAULT_PASSWORD
) -> Account:
    email = email or unique_email()
    response = await client.post("/auth/register", json={"email": email, "password": password})
    assert response.status_code == 201, response.text
    return Account(email=email, password=password, user_id=response.json()["id"])


async def login(client: AsyncClient, account: Account) -> None:
    response = await client.post(
        "/auth/login", json={"email": account.email, "password": account.password}
    )
    assert response.status_code == 200, response.text


async def register_and_login(
    client: AsyncClient, *, email: str | None = None, password: str = DEFAULT_PASSWORD
) -> Account:
    account = await register(client, email=email, password=password)
    await login(client, account)
    return account


async def create_vault(client: AsyncClient) -> str:
    response = await client.post("/vaults", json={})
    assert response.status_code == 201, response.text
    return response.json()["id"]
