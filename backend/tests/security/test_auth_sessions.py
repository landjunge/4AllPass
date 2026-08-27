"""Security-boundary tests: auth and sessions.

These tests exist so the API cannot claim a security property that it does
not actually implement. Device DELETE is metadata-only. WebAuthn fields are
client-asserted. Snapshot races must yield exactly one winner and a 409.
"""
from __future__ import annotations

import time
import uuid

from app.core.security import token_lookup_key
from app.core.sessions import get_session_store

import pytest

from tests.security.helpers import (
    DEVICE_A,
    DEVICE_B,
    PASSWORD,
    _auth,
    _commit,
    _cred_b64,
    _cred_path,
    _device_envelope,
    _dke,
    _dke_path,
    _email,
    _entry,
    _master_envelope,
    _sealed_manifest,
    _signup,
    _vault,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

# --- Auth / sessions ---------------------------------------------------------


async def test_me_does_not_leak_password_hash_or_oauth_fields(client):
    _, token = await _signup(client)
    me = await client.get("/api/v1/auth/me", headers=_auth(token))
    assert me.status_code == 200
    body = me.json()
    assert set(body) == {"id", "email", "createdAt"}
    joined = " ".join(str(v) for v in body.values()).lower()
    assert "argon2" not in joined
    assert "password" not in joined


async def test_invalid_and_expired_session_are_rejected(client):
    _, token = await _signup(client)
    bogus = await client.get("/api/v1/auth/me", headers=_auth("not-a-real-token"))
    assert bogus.status_code == 401

    store = get_session_store()
    key = token_lookup_key(token)
    expires_at, record = store._sessions[key]
    store._sessions[key] = (time.time() - 1, record)
    expired = await client.get("/api/v1/auth/me", headers=_auth(token))
    assert expired.status_code == 401
    assert expires_at > 0


async def test_logout_revokes_only_that_token_concurrent_sessions_survive(client):
    email, first = await _signup(client)
    second_login = await client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
    assert second_login.status_code == 200
    second = second_login.json()["token"]
    assert second != first

    assert (await client.get("/api/v1/auth/me", headers=_auth(first))).status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=_auth(second))).status_code == 200

    logout = await client.post("/api/v1/auth/logout", headers=_auth(first))
    assert logout.status_code == 204
    assert (await client.get("/api/v1/auth/me", headers=_auth(first))).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=_auth(second))).status_code == 200


async def test_x_user_id_header_cannot_spoof_the_session_user(client):
    _, alice = await _signup(client)
    _, bob = await _signup(client)
    bob_me = await client.get("/api/v1/auth/me", headers=_auth(bob))
    bob_id = bob_me.json()["id"]

    spoofed = await client.get(
        "/api/v1/auth/me",
        headers={**_auth(alice), "X-User-Id": bob_id, "X-Account-Id": bob_id},
    )
    assert spoofed.status_code == 200
    assert spoofed.json()["id"] != bob_id


async def test_login_rate_limit_trips(client):
    email, _ = await _signup(client)
    last = None
    for _ in range(11):
        last = await client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "definitely-wrong-password"},
        )
    assert last is not None
    assert last.status_code == 429


async def test_register_rejects_mass_assignment(client):
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": _email(),
            "password": PASSWORD,
            "isAdmin": True,
            "ownerUserId": str(uuid.uuid4()),
        },
    )
    assert response.status_code == 422



async def test_inactive_user_cannot_use_a_live_token(client, engine):
    from sqlalchemy import update

    from app.models.user import User

    email, token = await _signup(client)
    async with engine.begin() as conn:
        await conn.execute(update(User).where(User.email == email).values(is_active=False))

    response = await client.get("/api/v1/auth/me", headers=_auth(token))
    assert response.status_code == 401


