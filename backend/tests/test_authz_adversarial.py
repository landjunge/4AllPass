"""Attack-driven tests for the server security boundary.

Written in the style of ``packages/crypto/test/adversarial-*.test.ts``: each
group states an attacker capability and asserts the server refuses it. The
positive-path tests live in ``test_auth.py`` / ``test_ownership.py``; this file
is only about what must **not** work.

The boundary under test is:

    request -> authentication -> authenticated user -> vault ownership
            -> device belongs to vault -> encrypted blob

Every step is exercised from the outside, over HTTP, because that is the only
surface an attacker has.
"""

from __future__ import annotations

import base64
import logging
import uuid
from dataclasses import dataclass

import pytest
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.sessions import get_session_store
from app.models.user import User
from tests.helpers import (
    API,
    PASSWORD,
    Account,
    create_vault,
    login,
    master_envelope,
    register,
    unique_email,
)

pytestmark = pytest.mark.asyncio(loop_scope="session")

# Device ids are scoped to a vault, so the same one deliberately appears in
# two vaults below. WebAuthn credential ids are globally unique, so each
# victim mints its own.
DEVICE_ID = "dev_victim_0001"


def new_credential_id() -> tuple[str, str]:
    """A fresh credential id, as standard base64 (body) and base64url (path)."""
    raw = uuid.uuid4().bytes + uuid.uuid4().bytes
    return (
        base64.b64encode(raw).decode(),
        base64.urlsafe_b64encode(raw).decode().rstrip("="),
    )


@dataclass(frozen=True)
class Victim:
    account: Account
    vault_id: str
    credential_id: str
    credential_path_id: str


def _device_key_envelope(vault_id: str, credential_id: str, device_id: str = DEVICE_ID) -> dict:
    return {
        "version": 1,
        "vaultId": vault_id,
        "deviceId": device_id,
        "credentialId": credential_id,
        "deviceKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        "tag": "AgICAgICAgICAgICAgICAg==",
    }


async def _victim_with_full_vault(client_factory) -> Victim:
    """An account with a vault, a snapshot, a device, and a mirrored envelope."""
    victim = await register(client_factory())
    vault_id = await create_vault(victim)
    credential_id, credential_path_id = new_credential_id()

    snapshot = await victim.client.post(
        f"{API}/vaults/{vault_id}/snapshots",
        headers=victim.auth,
        json={
            "revision": 1,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "envelopes": [master_envelope()],
            "entries": [],
        },
    )
    assert snapshot.status_code == 200, snapshot.text

    device = await victim.client.post(
        f"{API}/vaults/{vault_id}/devices",
        headers=victim.auth,
        json={"deviceId": DEVICE_ID, "label": "Victim laptop"},
    )
    assert device.status_code == 200, device.text

    credential = await victim.client.post(
        f"{API}/vaults/{vault_id}/devices/{DEVICE_ID}/credentials",
        headers=victim.auth,
        json={
            "credentialId": credential_id,
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert credential.status_code == 200, credential.text

    mirror = await victim.client.put(
        f"{API}/vaults/{vault_id}/devices/{DEVICE_ID}"
        f"/credentials/{credential_path_id}/device-key-envelope",
        headers=victim.auth,
        json=_device_key_envelope(vault_id, credential_id),
    )
    assert mirror.status_code == 200, mirror.text
    return Victim(victim, vault_id, credential_id, credential_path_id)


def _protected_requests(victim: Victim) -> list[tuple[str, str, dict | None]]:
    """Every route behind vault ownership, with a body where one is required."""
    vault_id = victim.vault_id
    base = f"{API}/vaults/{vault_id}"
    envelope_path = (
        f"{base}/devices/{DEVICE_ID}"
        f"/credentials/{victim.credential_path_id}/device-key-envelope"
    )
    return [
        ("GET", base, None),
        ("GET", f"{base}/snapshot", None),
        (
            "POST",
            f"{base}/snapshots",
            {
                "revision": 2,
                "vaultKeyVersion": 1,
                "cryptoProtocolVersion": 1,
                "envelopes": [master_envelope()],
                "entries": [],
            },
        ),
        ("GET", f"{base}/devices", None),
        ("POST", f"{base}/devices", {"deviceId": "dev_attacker_0001", "label": "Attacker"}),
        ("GET", f"{base}/devices/{DEVICE_ID}", None),
        ("DELETE", f"{base}/devices/{DEVICE_ID}", None),
        (
            "POST",
            f"{base}/devices/{DEVICE_ID}/credentials",
            {
                "credentialId": new_credential_id()[0],
                "rpId": "localhost",
                "mechanism": "prf",
                "prfSupported": True,
                "largeBlobSupported": False,
            },
        ),
        ("GET", envelope_path, None),
        ("PUT", envelope_path, _device_key_envelope(vault_id, victim.credential_id)),
    ]


# --------------------------------------------------------------------------
# Missing authentication
# --------------------------------------------------------------------------


async def test_every_vault_route_rejects_anonymous_callers(client_factory, anonymous_client):
    victim = await _victim_with_full_vault(client_factory)

    for method, path, body in _protected_requests(victim):
        response = await anonymous_client.request(method, path, json=body)
        assert response.status_code == 401, f"{method} {path} -> {response.status_code}"


@pytest.mark.parametrize(
    "header",
    [
        "",
        "Bearer",
        "Bearer ",
        "Basic dXNlcjpwYXNz",
        "Bearer not-a-real-token",
        "bearer " + "a" * 43,
    ],
)
async def test_forged_authorization_headers_are_rejected(anonymous_client, header):
    response = await anonymous_client.get(f"{API}/auth/me", headers={"Authorization": header})
    assert response.status_code == 401


async def test_forged_session_cookie_is_rejected(anonymous_client):
    settings = get_settings()
    anonymous_client.cookies.set(settings.session_cookie_name, "forged-session-value")
    try:
        response = await anonymous_client.get(f"{API}/auth/me")
        assert response.status_code == 401
    finally:
        anonymous_client.cookies.clear()


# --------------------------------------------------------------------------
# Horizontal privilege escalation / IDOR
# --------------------------------------------------------------------------


async def test_attacker_cannot_touch_any_route_of_a_foreign_vault(client_factory):
    """The whole ownership-gated surface, not just the endpoint people remember."""
    victim = await _victim_with_full_vault(client_factory)
    attacker = await register(client_factory())

    for method, path, body in _protected_requests(victim):
        response = await attacker.client.request(method, path, headers=attacker.auth, json=body)
        assert response.status_code == 404, f"{method} {path} -> {response.status_code}"
        assert response.json()["detail"] == "vault not found"


async def test_foreign_vault_is_indistinguishable_from_a_nonexistent_one(client_factory):
    """Otherwise the API is an oracle for which vault ids exist."""
    victim = await _victim_with_full_vault(client_factory)
    attacker = await register(client_factory())

    invented = await attacker.client.get(f"{API}/vaults/{uuid.uuid4()}", headers=attacker.auth)
    foreign = await attacker.client.get(
        f"{API}/vaults/{victim.vault_id}", headers=attacker.auth
    )

    assert invented.status_code == foreign.status_code == 404
    assert invented.json() == foreign.json()


async def test_vault_ids_cannot_be_enumerated(client_factory):
    """Ids are random UUIDs and every miss answers identically."""
    attacker = await register(client_factory())
    own_vault = await create_vault(attacker)

    probes = [str(uuid.uuid4()) for _ in range(25)]
    probes.append("00000000-0000-0000-0000-000000000001")
    for probe in probes:
        response = await attacker.client.get(f"{API}/vaults/{probe}", headers=attacker.auth)
        assert response.status_code == 404
        assert response.json() == {"detail": "vault not found"}

    mine = await attacker.client.get(f"{API}/vaults/{own_vault}", headers=attacker.auth)
    assert mine.status_code == 200


async def test_device_id_from_another_vault_cannot_be_used_in_my_own(client_factory):
    """A known device id must not resolve just because the caller owns *a* vault.

    This is the cross-tenant lookup mistake: scoping the device query by id
    alone would let an attacker read a victim's device metadata through their
    own vault, and ownership of the vault would look like it had been checked.
    """
    victim = await _victim_with_full_vault(client_factory)
    attacker = await register(client_factory())
    attacker_vault = await create_vault(attacker)

    through_own_vault = await attacker.client.get(
        f"{API}/vaults/{attacker_vault}/devices/{DEVICE_ID}", headers=attacker.auth
    )
    assert through_own_vault.status_code == 404
    assert through_own_vault.json()["detail"] == "device not found"

    through_victim_vault = await attacker.client.get(
        f"{API}/vaults/{victim.vault_id}/devices/{DEVICE_ID}", headers=attacker.auth
    )
    assert through_victim_vault.status_code == 404

    listing = await attacker.client.get(
        f"{API}/vaults/{attacker_vault}/devices", headers=attacker.auth
    )
    assert listing.status_code == 200
    assert listing.json() == []


async def test_device_key_envelope_does_not_cross_vaults(client_factory):
    """The mirrored blob is opaque, but who may fetch it still matters."""
    victim = await _victim_with_full_vault(client_factory)
    attacker = await register(client_factory())
    attacker_vault = await create_vault(attacker)

    await attacker.client.post(
        f"{API}/vaults/{attacker_vault}/devices",
        headers=attacker.auth,
        json={"deviceId": DEVICE_ID, "label": "Same id, different vault"},
    )

    # Same device id, same credential id, but this vault has neither envelope.
    through_own = await attacker.client.get(
        f"{API}/vaults/{attacker_vault}/devices/{DEVICE_ID}"
        f"/credentials/{victim.credential_path_id}/device-key-envelope",
        headers=attacker.auth,
    )
    assert through_own.status_code == 404

    through_victim = await attacker.client.get(
        f"{API}/vaults/{victim.vault_id}/devices/{DEVICE_ID}"
        f"/credentials/{victim.credential_path_id}/device-key-envelope",
        headers=attacker.auth,
    )
    assert through_victim.status_code == 404


async def test_credential_registration_does_not_reveal_other_accounts(client_factory):
    """Re-registering someone else's credential id must not be distinguishable."""
    victim = await _victim_with_full_vault(client_factory)
    attacker = await register(client_factory())
    attacker_vault = await create_vault(attacker)
    await attacker.client.post(
        f"{API}/vaults/{attacker_vault}/devices",
        headers=attacker.auth,
        json={"deviceId": "dev_attacker_0002", "label": "Attacker"},
    )

    taken = await attacker.client.post(
        f"{API}/vaults/{attacker_vault}/devices/dev_attacker_0002/credentials",
        headers=attacker.auth,
        json={
            "credentialId": victim.credential_id,
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert taken.status_code == 409
    assert taken.json()["detail"] == "credential already registered"


# --------------------------------------------------------------------------
# Identity spoofing / mass assignment
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "forged",
    [
        {"ownerUserId": "00000000-0000-0000-0000-000000000001"},
        {"owner_id": "00000000-0000-0000-0000-000000000001"},
        {"userId": "00000000-0000-0000-0000-000000000001"},
        {"accountId": "00000000-0000-0000-0000-000000000001"},
        {"isActive": True, "id": "00000000-0000-0000-0000-000000000001"},
    ],
)
async def test_forged_ownership_fields_are_rejected_not_ignored(client_factory, forged):
    """A silently dropped ``ownerId`` is a vulnerability waiting for a schema change."""
    attacker = await register(client_factory())
    vault_id = await create_vault(attacker)
    response = await attacker.client.post(
        f"{API}/vaults/{vault_id}/devices",
        headers=attacker.auth,
        json={"deviceId": "dev_forged_0001", "label": "Forged", **forged},
    )
    assert response.status_code == 422


async def test_forged_owner_in_registration_does_not_grant_a_foreign_vault(client_factory):
    victim = await _victim_with_full_vault(client_factory)

    attacker_client = client_factory()
    forged = await attacker_client.post(
        f"{API}/auth/register",
        json={
            "email": unique_email("attacker"),
            "password": PASSWORD,
            "issueBearerToken": True,
            "id": "00000000-0000-0000-0000-000000000001",
        },
    )
    assert forged.status_code == 422

    attacker = await register(attacker_client)
    assert (
        await attacker_client.get(f"{API}/vaults/{victim.vault_id}", headers=attacker.auth)
    ).status_code == 404


async def test_vault_creation_ignores_any_client_supplied_owner(client_factory):
    """``POST /vaults`` takes no body at all; ownership comes from the session."""
    attacker = await register(client_factory())
    victim = await register(client_factory())

    created = await attacker.client.post(
        f"{API}/vaults",
        headers=attacker.auth,
        json={"ownerUserId": victim.account_id},
    )
    # Either the body is refused outright, or it is irrelevant — never honoured.
    assert created.status_code in (201, 422)

    victim_vaults = await victim.client.get(f"{API}/vaults", headers=victim.auth)
    assert victim_vaults.json() == []


# --------------------------------------------------------------------------
# Session lifecycle
# --------------------------------------------------------------------------


async def test_expired_session_cannot_be_reused(client_factory):
    account = await register(client_factory())
    store = get_session_store()
    record = await store.get(account.token)
    assert record is not None

    await store.put(account.token, record, ttl_seconds=-1)

    response = await account.client.get(f"{API}/auth/me", headers=account.auth)
    assert response.status_code == 401
    assert response.json()["detail"] == "invalid or expired session"


async def test_session_is_dead_after_logout_and_logout_is_idempotent(client_factory):
    account = await register(client_factory())
    assert (await account.client.get(f"{API}/auth/me", headers=account.auth)).status_code == 200

    first = await account.client.post(f"{API}/auth/logout", headers=account.auth)
    assert first.status_code == 204
    second = await account.client.post(f"{API}/auth/logout", headers=account.auth)
    assert second.status_code == 204

    assert (await account.client.get(f"{API}/auth/me", headers=account.auth)).status_code == 401


async def test_login_issues_a_new_session_rather_than_adopting_one(client_factory):
    """Session fixation: authenticating must not keep a pre-existing identifier."""
    settings = get_settings()
    email = unique_email()
    await register(client_factory(), email=email, bearer=False)

    planted = "attacker-chosen-session-id"
    # Sent as a raw header so the value is exactly what an attacker would
    # inject, with no cookie-jar normalisation in between.
    planted_cookie = {"Cookie": f"{settings.session_cookie_name}={planted}"}

    before = await client_factory().get(f"{API}/auth/me", headers=planted_cookie)
    assert before.status_code == 401

    response = await client_factory().post(
        f"{API}/auth/login",
        json={"email": email, "password": PASSWORD},
        headers=planted_cookie,
    )
    assert response.status_code == 200
    issued = response.cookies[settings.session_cookie_name]
    assert issued != planted

    after = await client_factory().get(f"{API}/auth/me", headers=planted_cookie)
    assert after.status_code == 401


async def test_logout_does_not_revoke_other_sessions_of_the_same_account(client_factory):
    """Per-session revocation, so signing out one browser is not a global event."""
    email = unique_email()
    first = await register(client_factory(), email=email)
    second = await login(client_factory(), email)

    assert (await first.client.post(f"{API}/auth/logout", headers=first.auth)).status_code == 204
    assert (await first.client.get(f"{API}/auth/me", headers=first.auth)).status_code == 401
    assert (await second.client.get(f"{API}/auth/me", headers=second.auth)).status_code == 200


async def test_deactivated_account_cannot_use_an_existing_session(client_factory, engine):
    account = await register(client_factory())
    assert (await account.client.get(f"{API}/auth/me", headers=account.auth)).status_code == 200

    async with AsyncSession(engine) as session:
        await session.execute(
            update(User).where(User.id == uuid.UUID(account.account_id)).values(is_active=False)
        )
        await session.commit()

    assert (await account.client.get(f"{API}/auth/me", headers=account.auth)).status_code == 401


async def test_a_session_only_ever_speaks_for_its_own_account(client_factory):
    alice = await register(client_factory())
    bob = await register(client_factory())

    seen = await bob.client.get(f"{API}/auth/me", headers=alice.auth)
    assert seen.status_code == 200
    assert seen.json()["email"] == alice.email
    assert seen.json()["id"] == alice.account_id


# --------------------------------------------------------------------------
# CSRF (cookie sessions only)
# --------------------------------------------------------------------------


async def test_cookie_session_rejects_unsafe_requests_without_a_csrf_token(client_factory):
    account = await register(client_factory(), bearer=False)
    response = await account.client.post(f"{API}/vaults")
    assert response.status_code == 403
    assert response.json()["detail"] == "csrf token missing"


@pytest.mark.parametrize("forged", ["", "not-the-right-token", "a" * 43])
async def test_cookie_session_rejects_a_wrong_csrf_token(client_factory, forged):
    account = await register(client_factory(), bearer=False)
    response = await account.client.post(f"{API}/vaults", headers={"X-CSRF-Token": forged})
    assert response.status_code == 403


async def test_csrf_token_of_another_session_does_not_work(client_factory):
    """Binding to the session is what a same-site cookie-writer cannot forge."""
    victim = await register(client_factory(), bearer=False)
    other = await register(client_factory(), bearer=False)

    response = await victim.client.post(f"{API}/vaults", headers=other.csrf)
    assert response.status_code == 403


async def test_cookie_session_accepts_the_matching_csrf_token(client_factory):
    account = await register(client_factory(), bearer=False)
    response = await account.client.post(f"{API}/vaults", headers=account.csrf)
    assert response.status_code == 201


async def test_safe_methods_need_no_csrf_token(client_factory):
    account = await register(client_factory(), bearer=False)
    assert (await account.client.get(f"{API}/auth/me")).status_code == 200
    assert (await account.client.get(f"{API}/vaults")).status_code == 200


async def test_bearer_sessions_are_exempt_from_csrf(client_factory):
    """An explicitly attached header is not ambient authority."""
    account = await register(client_factory())
    response = await account.client.post(f"{API}/vaults", headers=account.auth)
    assert response.status_code == 201


async def test_csrf_cookie_is_readable_by_the_page_but_the_session_cookie_is_not(client_factory):
    settings = get_settings()
    client = client_factory()
    response = await client.post(
        f"{API}/auth/register", json={"email": unique_email(), "password": PASSWORD}
    )
    assert response.status_code == 200

    by_name = {cookie.name: cookie for cookie in response.cookies.jar}
    session_cookie = by_name[settings.session_cookie_name]
    csrf_cookie = by_name[settings.csrf_cookie_name]

    assert session_cookie.has_nonstandard_attr("HttpOnly")
    # The page has to echo this one back in a header, so it must be readable.
    assert not csrf_cookie.has_nonstandard_attr("HttpOnly")
    for cookie in (session_cookie, csrf_cookie):
        assert cookie.get_nonstandard_attr("SameSite", "").lower() == "strict"


# --------------------------------------------------------------------------
# Secret leakage
# --------------------------------------------------------------------------

SECRET_KEY_NAMES = {
    "password",
    "passwordhash",
    "accountpasswordhash",
    "account_password_hash",
    "masterpassword",
    "vaultkey",
    "devicekey",
    "devicewrappingkey",
    "prf",
    "prfoutput",
    "publickey",
    "public_key",
    "sessionsecret",
    "csrf",
    "csrftoken",
}


def _walk(node, path="$"):
    if isinstance(node, dict):
        for key, value in node.items():
            yield path, key, value
            yield from _walk(value, f"{path}.{key}")
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from _walk(value, f"{path}[{index}]")


async def test_no_api_response_carries_account_or_key_secrets(client_factory):
    """Audit every field of every response produced by a full happy path."""
    victim = await _victim_with_full_vault(client_factory)
    account, vault_id = victim.account, victim.vault_id

    responses = {
        "me": await account.client.get(f"{API}/auth/me", headers=account.auth),
        "vaults": await account.client.get(f"{API}/vaults", headers=account.auth),
        "vault": await account.client.get(f"{API}/vaults/{vault_id}", headers=account.auth),
        "snapshot": await account.client.get(
            f"{API}/vaults/{vault_id}/snapshot", headers=account.auth
        ),
        "devices": await account.client.get(
            f"{API}/vaults/{vault_id}/devices", headers=account.auth
        ),
        "device": await account.client.get(
            f"{API}/vaults/{vault_id}/devices/{DEVICE_ID}", headers=account.auth
        ),
        "envelope": await account.client.get(
            f"{API}/vaults/{vault_id}/devices/{DEVICE_ID}"
            f"/credentials/{victim.credential_path_id}/device-key-envelope",
            headers=account.auth,
        ),
    }

    for name, response in responses.items():
        assert response.status_code == 200, f"{name}: {response.text}"
        raw = response.text
        assert PASSWORD not in raw, f"{name} echoed the account password"
        assert "$argon2" not in raw, f"{name} exposed a password hash"
        assert account.token is not None
        assert account.token not in raw, f"{name} exposed the session token"

        for path, key, _value in _walk(response.json()):
            assert key.lower() not in SECRET_KEY_NAMES, f"{name} exposed {path}.{key}"


async def test_auth_me_exposes_only_account_identity(client_factory):
    account = await register(client_factory())
    response = await account.client.get(f"{API}/auth/me", headers=account.auth)
    assert response.status_code == 200
    assert set(response.json()) == {"id", "email", "createdAt"}


async def test_failed_login_does_not_disclose_whether_the_account_exists(client_factory):
    client = client_factory()
    email = unique_email()
    await register(client, email=email)

    wrong_password = await client.post(
        f"{API}/auth/login", json={"email": email, "password": "wrong-password-here"}
    )
    unknown_account = await client.post(
        f"{API}/auth/login", json={"email": unique_email(), "password": "wrong-password-here"}
    )

    assert wrong_password.status_code == unknown_account.status_code == 401
    assert wrong_password.json() == unknown_account.json()


async def test_credentials_never_reach_the_logs(client_factory, caplog):
    """Nothing in the request may be echoed into a log record."""
    client = client_factory()
    email = unique_email()

    with caplog.at_level(logging.DEBUG):
        account = await register(client, email=email)
        await client.post(f"{API}/vaults", headers=account.auth)
        await client.post(
            f"{API}/auth/login", json={"email": email, "password": "wrong-password-here"}
        )

    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert PASSWORD not in logged
    assert "wrong-password-here" not in logged
    assert account.token is not None
    assert account.token not in logged
    assert "$argon2" not in logged
