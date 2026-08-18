import pytest

from app.core.config import get_settings
from tests.helpers import API, PASSWORD, login, register, unique_email

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_register_login_me_logout(client_factory):
    client = client_factory()
    email = unique_email()
    account = await register(client, email=email)

    me = await client.get(f"{API}/auth/me", headers=account.auth)
    assert me.status_code == 200
    assert me.json()["email"] == email

    # Case-insensitive: the address is one account, however it is typed.
    second = await login(client, email.upper())
    assert second.token != account.token

    logout = await client.post(f"{API}/auth/logout", headers=second.auth)
    assert logout.status_code == 204

    after = await client.get(f"{API}/auth/me", headers=second.auth)
    assert after.status_code == 401


async def test_login_wrong_password(client_factory):
    client = client_factory()
    email = unique_email()
    await register(client, email=email)
    response = await client.post(
        f"{API}/auth/login",
        json={"email": email, "password": "definitely-wrong-password"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid credentials"


async def test_register_duplicate_email(client_factory):
    client = client_factory()
    email = unique_email()
    await register(client, email=email)
    second = await client.post(
        f"{API}/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert second.status_code == 409


async def test_register_duplicate_email_differing_only_in_case(client_factory):
    """``Ada@…`` and ``ada@…`` must not become two accounts."""
    client = client_factory()
    email = unique_email()
    await register(client, email=email)
    second = await client.post(
        f"{API}/auth/register", json={"email": email.upper(), "password": PASSWORD}
    )
    assert second.status_code == 409


async def test_me_without_token(anonymous_client):
    response = await anonymous_client.get(f"{API}/auth/me")
    assert response.status_code == 401


async def test_register_rejects_short_password(anonymous_client):
    response = await anonymous_client.post(
        f"{API}/auth/register",
        json={"email": unique_email(), "password": "short"},
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "address",
    [
        "admin@vault.internal",
        "ops@homelab.test",
        "user@nas.local",
    ],
)
async def test_register_accepts_self_hosted_domains(client_factory, address):
    """A LAN deployment must be able to name its own users.

    Rejecting RFC 2606 / RFC 6761 special-use domains would lock a homelab or
    air-gapped install out of its own server.
    """
    client = client_factory()
    unique = address.replace("@", f"-{unique_email().split('@')[0]}@")
    response = await client.post(
        f"{API}/auth/register", json={"email": unique, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    assert response.json()["email"] == unique.lower()


@pytest.mark.parametrize("address", ["not-an-email", "@example.com", "a@@b.com", "a b@example.com"])
async def test_register_rejects_malformed_email(anonymous_client, address):
    response = await anonymous_client.post(
        f"{API}/auth/register", json={"email": address, "password": PASSWORD}
    )
    assert response.status_code == 422


async def test_registration_is_not_deliverability_checked(client_factory):
    """No DNS lookup: an air-gapped host must still be able to register."""
    client = client_factory()
    email = f"user-{unique_email().split('@')[0]}@definitely-not-a-real-domain-4allpass.test"
    response = await client.post(
        f"{API}/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text


async def test_browser_flow_never_exposes_the_token_to_javascript(client_factory):
    """Default (browser) register/login: session cookie only, no body token."""
    client = client_factory()
    settings = get_settings()
    email = unique_email()

    response = await client.post(
        f"{API}/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert response.status_code == 200, response.text
    assert response.json()["token"] is None

    session_cookie = next(
        cookie for cookie in response.cookies.jar if cookie.name == settings.session_cookie_name
    )
    assert session_cookie.value
    # http-only is exposed by cookiejar as a non-standard attribute.
    assert session_cookie.has_nonstandard_attr("HttpOnly")

    # The cookie alone authenticates a safe request; no header needed.
    me = await client.get(f"{API}/auth/me")
    assert me.status_code == 200
    assert me.json()["email"] == email


async def test_cookie_session_is_cleared_on_logout(client_factory):
    client = client_factory()
    settings = get_settings()
    account = await register(client, bearer=False)

    assert (await client.get(f"{API}/auth/me")).status_code == 200

    logout = await client.post(f"{API}/auth/logout", headers=account.csrf)
    assert logout.status_code == 204
    assert not client.cookies.get(settings.session_cookie_name)
    assert (await client.get(f"{API}/auth/me")).status_code == 401
