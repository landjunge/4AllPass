"""Authentication: register, login, logout, /auth/me, and session lifetime."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import hash_session_token
from app.models.session import UserSession
from app.models.user import User
from tests.helpers import (
    DEFAULT_PASSWORD,
    login,
    plant_session_cookie,
    register,
    register_and_login,
    unique_email,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

COOKIE_NAME = get_settings().session_cookie_name


async def test_register_creates_account_and_returns_no_secrets(client):
    email = unique_email()
    response = await client.post(
        "/auth/register", json={"email": email, "password": DEFAULT_PASSWORD}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == email
    assert body["is_active"] is True
    assert set(body) == {"id", "email", "is_active", "created_at"}
    # Registration is not a login: no session is minted here.
    assert COOKIE_NAME not in response.cookies


async def test_register_stores_a_hash_not_the_password(client, db_session):
    account = await register(client)

    user = (
        await db_session.execute(select(User).where(User.email == account.email))
    ).scalar_one()
    assert user.account_password_hash is not None
    assert user.account_password_hash != account.password
    assert account.password not in user.account_password_hash
    assert user.account_password_hash.startswith("$argon2id$")


async def test_register_normalizes_email_case(client):
    email = unique_email()
    response = await client.post(
        "/auth/register", json={"email": email.upper(), "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 201
    assert response.json()["email"] == email.lower()


async def test_duplicate_registration_is_rejected(client):
    account = await register(client)

    response = await client.post(
        "/auth/register", json={"email": account.email, "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 409


async def test_duplicate_registration_is_rejected_case_insensitively(client):
    account = await register(client)

    response = await client.post(
        "/auth/register", json={"email": account.email.upper(), "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 409


async def test_register_rejects_a_short_password(client):
    response = await client.post(
        "/auth/register", json={"email": unique_email(), "password": "short"}
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "email",
    ["not-an-email", "user@", "@example.com", "user@localhost", "user@vault.local"],
)
async def test_register_rejects_malformed_and_special_use_addresses(client, email):
    """Pins a deliberate constraint, not an accident.

    Account addresses are validated strictly, which also rules out special-use
    domains such as `.local` and `.test`. One canonical form per account keeps
    the unique index meaningful; the cost is that a self-hosted deployment must
    use a real domain for account identifiers. Noted in
    docs/backend-security-boundary.md §7.
    """
    response = await client.post("/auth/register", json={"email": email, "password": DEFAULT_PASSWORD})
    assert response.status_code == 422


async def test_login_success_sets_an_httponly_session_cookie(client):
    account = await register(client)

    response = await client.post(
        "/auth/login", json={"email": account.email, "password": account.password}
    )

    assert response.status_code == 200
    assert response.json()["id"] == account.user_id

    cookie_header = response.headers["set-cookie"]
    assert cookie_header.startswith(f"{COOKIE_NAME}=")
    assert "HttpOnly" in cookie_header
    assert "SameSite=lax" in cookie_header
    assert "Path=/" in cookie_header


async def test_login_with_wrong_password_fails(client):
    account = await register(client)

    response = await client.post(
        "/auth/login", json={"email": account.email, "password": "not-the-right-password"}
    )
    assert response.status_code == 401
    assert COOKIE_NAME not in client.cookies


async def test_login_for_an_unknown_account_fails_with_the_same_message(client):
    account = await register(client)

    wrong_password = await client.post(
        "/auth/login", json={"email": account.email, "password": "not-the-right-password"}
    )
    unknown_account = await client.post(
        "/auth/login", json={"email": unique_email(), "password": DEFAULT_PASSWORD}
    )

    # An attacker must not be able to read "this account exists" out of the
    # difference between the two answers.
    assert wrong_password.status_code == unknown_account.status_code == 401
    assert wrong_password.json() == unknown_account.json()


async def test_login_is_rejected_for_a_deactivated_account(client, db_session):
    account = await register(client)
    user = (
        await db_session.execute(select(User).where(User.email == account.email))
    ).scalar_one()
    user.is_active = False
    await db_session.commit()

    response = await client.post(
        "/auth/login", json={"email": account.email, "password": account.password}
    )
    assert response.status_code == 401


async def test_me_returns_the_authenticated_account(client):
    account = await register_and_login(client)

    response = await client.get("/auth/me")

    assert response.status_code == 200
    assert response.json()["id"] == account.user_id
    assert set(response.json()) == {"id", "email", "is_active", "created_at"}


async def test_me_requires_authentication(anonymous_client):
    response = await anonymous_client.get("/auth/me")
    assert response.status_code == 401


async def test_logout_revokes_the_session(client):
    await register_and_login(client)
    assert (await client.get("/auth/me")).status_code == 200

    logout = await client.post("/auth/logout")
    assert logout.status_code == 204

    assert (await client.get("/auth/me")).status_code == 401


async def test_a_logged_out_cookie_cannot_be_replayed(client, anonymous_client):
    await register_and_login(client)
    stolen = client.cookies[COOKIE_NAME]

    await client.post("/auth/logout")

    plant_session_cookie(anonymous_client, stolen)
    assert (await anonymous_client.get("/auth/me")).status_code == 401
    anonymous_client.cookies.clear()


async def test_logout_deletes_the_session_row(client, db_session):
    await register_and_login(client)
    token = client.cookies[COOKIE_NAME]

    await client.post("/auth/logout")

    stored = await db_session.execute(
        select(UserSession).where(UserSession.token_hash == hash_session_token(token))
    )
    assert stored.scalar_one_or_none() is None


async def test_logout_without_a_session_is_still_a_success(anonymous_client):
    response = await anonymous_client.post("/auth/logout")
    assert response.status_code == 204


async def test_logout_all_revokes_every_browser(client, other_client):
    account = await register_and_login(client)
    await login(other_client, account)

    assert (await other_client.get("/auth/me")).status_code == 200

    assert (await client.post("/auth/logout-all")).status_code == 204

    assert (await client.get("/auth/me")).status_code == 401
    assert (await other_client.get("/auth/me")).status_code == 401


async def test_an_expired_session_is_rejected_and_swept(client, db_session):
    await register_and_login(client)
    token = client.cookies[COOKIE_NAME]

    session = (
        await db_session.execute(
            select(UserSession).where(UserSession.token_hash == hash_session_token(token))
        )
    ).scalar_one()
    session.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db_session.commit()

    assert (await client.get("/auth/me")).status_code == 401

    remaining = await db_session.execute(
        select(UserSession).where(UserSession.token_hash == hash_session_token(token))
    )
    assert remaining.scalar_one_or_none() is None


async def test_deactivating_an_account_invalidates_its_live_session(client, db_session):
    account = await register_and_login(client)
    assert (await client.get("/auth/me")).status_code == 200

    user = (
        await db_session.execute(select(User).where(User.email == account.email))
    ).scalar_one()
    user.is_active = False
    await db_session.commit()

    assert (await client.get("/auth/me")).status_code == 401


async def test_the_session_token_is_not_stored_verbatim(client, db_session):
    await register_and_login(client)
    token = client.cookies[COOKIE_NAME]

    session = (
        await db_session.execute(
            select(UserSession).where(UserSession.token_hash == hash_session_token(token))
        )
    ).scalar_one()

    assert session.token_hash != token.encode()
    assert token.encode() not in session.token_hash
    assert len(session.token_hash) == 32
