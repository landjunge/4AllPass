"""Login must not reveal whether an account exists.

The account hasher runs Argon2id at 64 MiB, so a real account costs roughly two
orders of magnitude more wall time than a missing one. If `login` short-circuits
before verifying, that difference is a clean enumeration oracle — the rate limit
slows a scan down but leaves the signal intact.

The timing assertion uses a deliberately loose ratio. A tight bound would be
flaky on shared CI runners, and it does not need to be tight: the bug it guards
against produces a gap of 50x or more, not 2x.
"""

from __future__ import annotations

import time

import pytest

from app.core.security import hash_account_password

pytestmark = pytest.mark.asyncio(loop_scope="session")

PASSWORD = "correct horse battery staple"
WRONG = "not the right password at all"


async def _register(client, email: str) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": PASSWORD},
        headers={"X-Device-Id": "test-device-01"},
    )
    assert response.status_code in (200, 201), response.text


async def _time_login(client, email: str, password: str) -> float:
    start = time.perf_counter()
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
        headers={"X-Device-Id": "test-device-01"},
    )
    elapsed = time.perf_counter() - start
    assert response.status_code == 401, response.text
    # Same body either way: the message must not leak existence either.
    assert response.json()["detail"] == "invalid credentials"
    return elapsed


async def test_unknown_account_costs_the_same_as_a_wrong_password(client):
    await _register(client, "known@example.com")

    # Warm up: first call pays any lazy import or connection cost.
    await _time_login(client, "known@example.com", WRONG)

    known_samples = []
    unknown_samples = []
    for _ in range(3):
        known_samples.append(await _time_login(client, "known@example.com", WRONG))
        unknown_samples.append(await _time_login(client, "nobody@example.com", WRONG))
    known = min(known_samples)
    unknown = min(unknown_samples)

    assert known > 0 and unknown > 0
    ratio = max(known, unknown) / min(known, unknown)
    assert ratio < 5, (
        f"login timing distinguishes known from unknown accounts "
        f"(known={known * 1000:.1f}ms, unknown={unknown * 1000:.1f}ms, ratio={ratio:.1f}x)"
    )


@pytest.mark.asyncio(loop_scope="session")
async def test_dummy_verification_actually_runs_the_hasher():
    """The guard is worthless if it is optimized into a no-op."""
    from app.core.security import spend_verify_time

    real_hash = hash_account_password(PASSWORD)

    start = time.perf_counter()
    spend_verify_time()
    dummy_cost = time.perf_counter() - start

    start = time.perf_counter()
    _ = hash_account_password(PASSWORD) and real_hash
    real_cost = time.perf_counter() - start

    # Same order of magnitude as a genuine Argon2id operation.
    assert dummy_cost > real_cost / 10
