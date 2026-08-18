"""Adversarial tests for the backend security boundary.

Companion to `packages/crypto/test/adversarial-*.test.ts`, in the same spirit:
the positive tests prove the boundary works when it is used correctly, these
prove it refuses abuse. One group per attack class.

    identity spoofing      IDOR / enumeration     session forgery
    session fixation       session replay         mass assignment
    secret leakage         cross-site requests

Everything here assumes an attacker who already has a valid account of their
own — the interesting question is never "can a stranger get in", it is "what
can a legitimate user reach that is not theirs".
"""

from __future__ import annotations

import logging
import uuid

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.models.session import UserSession
from app.models.user import User
from tests.helpers import (
    DEFAULT_PASSWORD,
    TEST_HOST,
    create_vault,
    plant_session_cookie,
    register,
    register_and_login,
    unique_email,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

COOKIE_NAME = get_settings().session_cookie_name


# --------------------------------------------------------------------------
# Identity spoofing — the caller does not get to say who they are
# --------------------------------------------------------------------------


async def test_a_forged_owner_user_id_in_the_body_is_rejected(client, other_client):
    victim = await register_and_login(client)
    await register_and_login(other_client)

    response = await other_client.post("/vaults", json={"owner_user_id": victim.user_id})

    # `extra="forbid"`: the field is refused rather than silently ignored, so a
    # client cannot come away believing it set an owner.
    assert response.status_code == 422


async def test_a_forged_user_id_in_the_body_is_rejected(client):
    account = await register_and_login(client)

    response = await client.post("/vaults", json={"user_id": account.user_id})
    assert response.status_code == 422


async def test_a_forged_is_active_flag_is_rejected(anonymous_client):
    response = await anonymous_client.post(
        "/auth/register",
        json={"email": unique_email(), "password": DEFAULT_PASSWORD, "is_active": False},
    )
    assert response.status_code == 422


async def test_a_user_id_in_the_query_string_does_not_change_the_caller(
    client, other_client, db_session
):
    victim = await register_and_login(client)
    attacker = await register_and_login(other_client)

    response = await other_client.post(
        f"/vaults?user_id={victim.user_id}&owner_user_id={victim.user_id}", json={}
    )
    assert response.status_code == 201

    vault_id = uuid.UUID(response.json()["id"])
    owner = (
        await db_session.execute(
            select(User).join(User.vaults).where(User.vaults.any(id=vault_id))
        )
    ).scalar_one()
    assert str(owner.id) == attacker.user_id


async def test_identity_headers_are_not_trusted(client, other_client):
    victim = await register_and_login(client)
    victim_vault = await create_vault(client)

    await register_and_login(other_client)

    response = await other_client.get(
        f"/vaults/{victim_vault}",
        headers={"X-User-Id": victim.user_id, "X-Forwarded-User": victim.email},
    )
    assert response.status_code == 404


async def test_a_session_token_presented_as_a_bearer_header_does_not_authenticate(
    client, anonymous_client
):
    """There is exactly one place a session token is read from: the cookie."""
    await register_and_login(client)
    token = client.cookies[COOKIE_NAME]

    response = await anonymous_client.get(
        "/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 401


# --------------------------------------------------------------------------
# IDOR / enumeration
# --------------------------------------------------------------------------


async def test_vault_ids_cannot_be_enumerated(client, other_client):
    await register_and_login(client)
    real_vaults = [await create_vault(client) for _ in range(3)]

    await register_and_login(other_client)

    answers = set()
    for vault_id in [*real_vaults, *(str(uuid.uuid4()) for _ in range(3))]:
        response = await other_client.get(f"/vaults/{vault_id}")
        answers.add((response.status_code, response.text))

    # Every id — three that exist, three that do not — produces one identical
    # answer, so walking the id space yields no signal.
    assert len(answers) == 1
    assert answers.pop()[0] == 404


async def test_a_malformed_vault_id_does_not_reach_the_database(other_client):
    await register_and_login(other_client)

    response = await other_client.get("/vaults/not-a-uuid")
    assert response.status_code == 422


async def test_the_device_list_of_a_foreign_vault_is_not_enumerable(client, other_client):
    await register_and_login(client)
    victim_vault = await create_vault(client)

    await register_and_login(other_client)

    foreign = await other_client.get(f"/vaults/{victim_vault}/devices")
    nonexistent = await other_client.get(f"/vaults/{uuid.uuid4()}/devices")

    assert foreign.status_code == nonexistent.status_code == 404
    assert foreign.json() == nonexistent.json()


# --------------------------------------------------------------------------
# Session forgery
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "forged",
    [
        "",
        "not-a-real-token",
        "a" * 43,
        "x" * 129,  # over the length bound, rejected before it is hashed
        "../../etc/passwd",
        "' OR 1=1 --",
    ],
)
async def test_a_forged_session_cookie_does_not_authenticate(anonymous_client, forged):
    plant_session_cookie(anonymous_client, forged)
    try:
        assert (await anonymous_client.get("/auth/me")).status_code == 401
    finally:
        anonymous_client.cookies.clear()


async def test_a_tampered_session_cookie_does_not_authenticate(client, anonymous_client):
    await register_and_login(client)
    token = client.cookies[COOKIE_NAME]

    flipped = ("B" if token[0] != "B" else "C") + token[1:]
    plant_session_cookie(anonymous_client, flipped)
    try:
        assert (await anonymous_client.get("/auth/me")).status_code == 401
    finally:
        anonymous_client.cookies.clear()

    # The genuine token still works, so the rejection was about the tampering.
    assert (await client.get("/auth/me")).status_code == 200


async def test_a_session_of_one_user_never_resolves_to_another(client, other_client):
    alice = await register_and_login(client)
    bob = await register_and_login(other_client)

    assert (await client.get("/auth/me")).json()["id"] == alice.user_id
    assert (await other_client.get("/auth/me")).json()["id"] == bob.user_id


# --------------------------------------------------------------------------
# Session fixation and replay
# --------------------------------------------------------------------------


async def test_login_replaces_a_planted_session_token(client, other_client):
    """The classic fixation setup: attacker plants a cookie, victim logs in.

    The attacker holds a token they minted themselves and gets it into the
    victim's browser. If login reused it, the attacker's cookie would silently
    become the victim's session.
    """
    await register_and_login(other_client)
    attacker_token = other_client.cookies[COOKIE_NAME]

    victim = await register(client)
    plant_session_cookie(client, attacker_token)

    await client.post("/auth/login", json={"email": victim.email, "password": victim.password})

    victim_token = client.cookies[COOKIE_NAME]
    assert victim_token != attacker_token
    assert (await client.get("/auth/me")).json()["id"] == victim.user_id

    # And the planted token is gone entirely, so the attacker's own browser
    # cannot ride it either.
    assert (await other_client.get("/auth/me")).status_code == 401


async def test_logging_in_twice_yields_two_independent_sessions(client, other_client):
    account = await register_and_login(client)
    first_token = client.cookies[COOKIE_NAME]

    await other_client.post(
        "/auth/login", json={"email": account.email, "password": account.password}
    )
    second_token = other_client.cookies[COOKIE_NAME]

    assert first_token != second_token

    await other_client.post("/auth/logout")

    # Signing out of one browser must not sign the other one out.
    assert (await client.get("/auth/me")).status_code == 200


async def test_a_session_cannot_outlive_its_own_deletion(client, anonymous_client, db_session):
    await register_and_login(client)
    token = client.cookies[COOKIE_NAME]

    await db_session.execute(select(UserSession))
    await client.post("/auth/logout-all")

    plant_session_cookie(anonymous_client, token)
    try:
        assert (await anonymous_client.get("/auth/me")).status_code == 401
    finally:
        anonymous_client.cookies.clear()


async def test_a_revoked_session_cannot_reach_vault_data(client, anonymous_client):
    await register_and_login(client)
    vault_id = await create_vault(client)
    token = client.cookies[COOKIE_NAME]

    await client.post("/auth/logout")

    plant_session_cookie(anonymous_client, token)
    try:
        assert (await anonymous_client.get(f"/vaults/{vault_id}")).status_code == 401
        assert (await anonymous_client.get(f"/vaults/{vault_id}/devices")).status_code == 401
    finally:
        anonymous_client.cookies.clear()


# --------------------------------------------------------------------------
# Secret leakage
# --------------------------------------------------------------------------


async def test_no_response_carries_a_password_hash_or_session_material(client):
    account = await register_and_login(client)
    vault_id = await create_vault(client)

    bodies = [
        (await client.get("/auth/me")).text,
        (await client.get("/vaults")).text,
        (await client.get(f"/vaults/{vault_id}")).text,
        (await client.get(f"/vaults/{vault_id}/devices")).text,
    ]

    for body in bodies:
        assert account.password not in body
        for banned in ("argon2", "password_hash", "account_password_hash", "token_hash",
                       "oauth_subject", "session_secret"):
            assert banned not in body


async def test_no_declared_response_model_has_a_secret_field(client):
    """Audits the field names of every schema the API declares, not just prose.

    A response model is the only thing standing between an ORM row and the
    wire, so the check is on the declared properties: if a secret column ever
    gains a schema field, this fails whether or not any route returns it today.
    """
    schema = (await client.get("/openapi.json")).json()

    declared_fields = {
        field
        for component in schema["components"]["schemas"].values()
        for field in component.get("properties", {})
    }

    assert declared_fields
    assert not declared_fields & {
        "account_password_hash",
        "password_hash",
        "token_hash",
        "oauth_provider",
        "oauth_subject",
        "public_key",
        "credential_id",
        "ciphertext",
        "nonce",
        "tag",
    }


async def test_credentials_and_session_tokens_never_reach_the_logs(client, caplog):
    """Runs with logging wide open, including SQLAlchemy's statement log.

    That is the interesting configuration: at DEBUG the engine echoes every
    statement and its bound parameters. The plaintext password still cannot
    appear, because only its Argon2id hash is ever bound; the session token
    cannot appear, because only its SHA-256 digest is.
    """
    caplog.set_level(logging.DEBUG)

    account = await register(client)
    await client.post(
        "/auth/login", json={"email": account.email, "password": account.password}
    )
    token = client.cookies[COOKIE_NAME]
    await client.get("/auth/me")
    await client.post("/vaults", json={})

    logged = caplog.text
    assert account.password not in logged
    assert token not in logged


# --------------------------------------------------------------------------
# Cross-site requests
# --------------------------------------------------------------------------


async def test_a_cross_origin_state_change_is_rejected(client):
    account = await register_and_login(client)

    response = await client.post(
        "/vaults", json={}, headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 403

    login = await client.post(
        "/auth/login",
        json={"email": account.email, "password": account.password},
        headers={"Origin": "https://evil.example"},
    )
    assert login.status_code == 403


async def test_a_cross_origin_referer_is_rejected_when_no_origin_is_sent(client):
    await register_and_login(client)

    response = await client.post(
        "/vaults", json={}, headers={"Referer": "https://evil.example/attack.html"}
    )
    assert response.status_code == 403


async def test_the_deployments_own_origin_is_accepted(client):
    await register_and_login(client)

    response = await client.post("/vaults", json={}, headers={"Origin": f"http://{TEST_HOST}"})
    assert response.status_code == 201


async def test_a_configured_origin_is_accepted(client):
    await register_and_login(client)

    configured = get_settings().cors_origins[0]
    response = await client.post("/vaults", json={}, headers={"Origin": configured})
    assert response.status_code == 201


async def test_a_cross_origin_read_is_not_blocked_by_the_origin_check(client):
    """Safe methods are exempt; CORS, not this check, decides who may read the answer."""
    await register_and_login(client)

    response = await client.get("/auth/me", headers={"Origin": "https://evil.example"})
    assert response.status_code == 200


async def test_a_lookalike_origin_is_not_accepted(client):
    await register_and_login(client)

    for lookalike in (
        f"http://{TEST_HOST}.evil.example",
        f"http://evil.example/?x=http://{TEST_HOST}",
        "null",
        f"http://{TEST_HOST}:9999",
    ):
        response = await client.post("/vaults", json={}, headers={"Origin": lookalike})
        assert response.status_code == 403, lookalike
