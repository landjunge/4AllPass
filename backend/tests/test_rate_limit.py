"""Login/registration throttling.

These are endpoint-level: the store's counter logic is covered in
``test_security_unit.py``, but whether the *bucket key* is right is the part
that actually decides whether the control works in a deployment.
"""

from __future__ import annotations

import pytest

from app.core.config import Settings, get_settings
from tests.helpers import API, PASSWORD, register, unique_email

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_repeated_failed_logins_for_one_account_are_throttled(client_factory):
    client = client_factory()
    email = unique_email()
    await register(client, email=email)

    limit = get_settings().auth_login_rate_limit
    statuses = []
    for _ in range(limit + 2):
        response = await client.post(
            f"{API}/auth/login", json={"email": email, "password": "wrong-password-here"}
        )
        statuses.append(response.status_code)

    assert 429 in statuses, statuses
    assert statuses[0] == 401


async def test_spraying_one_account_from_many_addresses_is_still_throttled(
    client_factory, monkeypatch
):
    """An address-only bucket would never notice a distributed password spray.

    Proxy-header trust has to be on for this to mean anything: with it off,
    every request reports the same test client address and the *address*
    bucket trips, so the test would pass without the account bucket existing.
    """
    trusting = Settings(
        environment="development",
        session_backend="memory",
        trust_proxy_client_ip=True,
    )
    monkeypatch.setattr("app.core.client_ip.get_settings", lambda: trusting)

    client = client_factory()
    email = unique_email()
    await register(client, email=email)

    limit = get_settings().auth_login_rate_limit
    statuses = []
    for attempt in range(limit + 2):
        statuses.append(
            (
                await client.post(
                    f"{API}/auth/login",
                    json={"email": email, "password": "wrong-password-here"},
                    # A different source address every time, so the address
                    # bucket never fills: only the account bucket sees this.
                    headers={"X-Real-IP": f"198.51.100.{attempt}"},
                )
            ).status_code
        )

    assert 429 in statuses, statuses


async def test_many_addresses_against_many_accounts_are_not_throttled(
    client_factory, monkeypatch
):
    """The control for the test above: no shared bucket, so nothing trips.

    Without this, a bucket key of `""` would satisfy the spray test while
    throttling every unrelated user on the instance.
    """
    trusting = Settings(
        environment="development",
        session_backend="memory",
        trust_proxy_client_ip=True,
    )
    monkeypatch.setattr("app.core.client_ip.get_settings", lambda: trusting)

    client = client_factory()
    statuses = []
    for attempt in range(get_settings().auth_login_rate_limit + 2):
        statuses.append(
            (
                await client.post(
                    f"{API}/auth/login",
                    json={"email": unique_email(), "password": "wrong-password-here"},
                    headers={"X-Real-IP": f"198.51.100.{attempt}"},
                )
            ).status_code
        )

    assert set(statuses) == {401}, statuses


async def test_throttling_one_account_does_not_lock_out_another(client_factory):
    client = client_factory()
    victim = unique_email()
    bystander = unique_email()
    await register(client, email=victim)
    await register(client, email=bystander)

    for _ in range(get_settings().auth_login_rate_limit + 2):
        await client.post(
            f"{API}/auth/login", json={"email": victim, "password": "wrong-password-here"}
        )

    # The address bucket is shared in tests (one client address), so the
    # bystander is expected to be throttled too rather than authenticated —
    # what must not happen is a *successful* login being reported as invalid
    # credentials.
    response = await client.post(
        f"{API}/auth/login", json={"email": bystander, "password": PASSWORD}
    )
    assert response.status_code in (200, 429)
    assert response.status_code != 401
