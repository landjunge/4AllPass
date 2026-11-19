"""AP-E03-P04-REVOKED-WRITES-v1 — revoked device rows block mutations only.

Contract under test (interim, ADR-015 §3 stays open):

- A session whose device id has a revoked ``Device`` row in *this* vault may
  read the vault and its revisions (recovery), but must not mutate anything:
  snapshot commit, device re-enrol, device revoke, credentials, Device-Key
  Envelope, WebAuthn challenges.
- Ownership still wins: a foreign vault is 404, not 403.
- A device without a row (legacy / newly claimed id) still writes — that
  remaining bearer-only gap is deliberate here.
- Revocation is scoped to one vault: the same id may still write another vault
  of the same account.
- Self-revoke is allowed (the row is still active at that moment); the next
  call from that session is denied.
"""
from __future__ import annotations

import asyncio
import base64
import uuid

import pytest

from tests.security.helpers import (
    DEVICE_A,
    DEVICE_B,
    PASSWORD,
    _auth,
    _commit,
    _cred_b64,
    _dke,
    _dke_path,
    _device_envelope,
    _email,
    _master_envelope,
    _sealed_manifest,
    _signup,
    _vault,
)

DEVICE_C = "dev_cccccccccccccccccccccccc"
DEVICE_NEW = "dev_nnnnnnnnnnnnnnnnnnnnnnnn"

# Same session-scoped loop as the other security suites: the Postgres engine
# pool is bound to the session loop (pytest.ini: default fixture loop scope).
pytestmark = pytest.mark.asyncio(loop_scope="session")


def _h(token: str, device_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Device-Id": device_id}


async def _login(client, email: str, device_id: str) -> str:
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": PASSWORD},
        headers={"X-Device-Id": device_id},
    )
    assert response.status_code == 200, response.text
    return response.json()["token"]


async def _commit_as(client, token: str, device_id: str, vault_id: str, **overrides):
    body = {
        "revision": 1,
        "vaultKeyVersion": 1,
        "cryptoProtocolVersion": 1,
        "envelopes": [_master_envelope()],
        "entries": [],
    }
    body.update(overrides)
    return await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=_h(token, device_id),
        json=body,
    )


async def _vault_with_revoked_device(client):
    """Owner keeps the default test device; DEVICE_A gets a row, a session, then revoke."""
    email, owner = await _signup(client)
    vault_id = await _vault(client, owner)
    first = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=_auth(owner),
        json={
            "revision": 1,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "envelopes": [_master_envelope(), _device_envelope(DEVICE_A)],
            "entries": [],
        },
    )
    assert first.status_code == 200, first.text
    registered = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(owner),
        json={"deviceId": DEVICE_A, "label": "Revoked phone"},
    )
    assert registered.status_code == 200, registered.text
    device_token = await _login(client, email, DEVICE_A)
    revoked = await client.delete(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", headers=_auth(owner)
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["revocation"] == "metadata_only"
    return email, owner, vault_id, device_token


async def test_revoked_device_cannot_commit_after_relogin(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)

    # Login itself is intentionally unchanged: it must still mint a session.
    relogged = await _login(client, email, DEVICE_A)

    denied = await _commit_as(
        client,
        relogged,
        DEVICE_A,
        vault_id,
        revision=2,
        sealedManifest=_sealed_manifest(),
    )
    assert denied.status_code == 403, denied.text
    assert denied.json()["detail"] == "device is revoked for this vault"

    # The denied call consumed no revision: the owner can still commit N+1.
    owner_commit = await _commit(
        client,
        owner,
        vault_id,
        revision=2,
        sealedManifest=_sealed_manifest(),
    )
    assert owner_commit.status_code == 200, owner_commit.text


async def test_revoked_device_cannot_reenrol_itself(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    relogged = await _login(client, email, DEVICE_A)

    again = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_h(relogged, DEVICE_A),
        json={"deviceId": DEVICE_A, "label": "Un-revoke attempt"},
    )
    assert again.status_code == 403, again.text
    assert again.json()["detail"] == "device is revoked for this vault"

    # It is still revoked on the server.
    listed = await client.get(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", headers=_auth(owner)
    )
    assert listed.status_code == 200
    assert listed.json()["revokedAt"] is not None


async def test_revoked_device_cannot_mutate_credentials_envelope_or_challenges(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    relogged = await _login(client, email, DEVICE_A)
    cred_id = _cred_b64()

    credential = await client.post(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}/credentials",
        headers=_h(relogged, DEVICE_A),
        json={
            "credentialId": cred_id,
            "rpId": "localhost",
            "mechanism": "prf",
            "prfSupported": True,
            "largeBlobSupported": False,
        },
    )
    assert credential.status_code == 403, credential.text

    envelope = await client.put(
        _dke_path(vault_id, DEVICE_A, cred_id),
        headers=_h(relogged, DEVICE_A),
        json=_dke(vault_id, DEVICE_A, cred_id),
    )
    assert envelope.status_code == 403, envelope.text

    challenge = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges",
        headers=_h(relogged, DEVICE_A),
        json={"purpose": "create", "deviceId": DEVICE_A},
    )
    assert challenge.status_code == 403, challenge.text

    revoke_again = await client.delete(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_B}", headers=_h(relogged, DEVICE_A)
    )
    assert revoke_again.status_code == 403, revoke_again.text


async def test_revoked_device_keeps_read_and_recovery(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    relogged = await _login(client, email, DEVICE_A)

    snapshot = await client.get(
        f"/api/v1/vaults/{vault_id}/snapshot", headers=_h(relogged, DEVICE_A)
    )
    assert snapshot.status_code == 200, snapshot.text
    assert snapshot.json()["revision"] == 1

    revisions = await client.get(
        f"/api/v1/vaults/{vault_id}/revisions", headers=_h(relogged, DEVICE_A)
    )
    assert revisions.status_code == 200, revisions.text

    historic = await client.get(
        f"/api/v1/vaults/{vault_id}/revisions/1", headers=_h(relogged, DEVICE_A)
    )
    assert historic.status_code == 200, historic.text


async def test_active_other_device_and_unregistered_id_can_write(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)

    # A registered, active device row is unaffected.
    assert (
        await client.post(
            f"/api/v1/vaults/{vault_id}/devices",
            headers=_auth(owner),
            json={"deviceId": DEVICE_B, "label": "Active tablet"},
        )
    ).status_code == 200
    active_token = await _login(client, email, DEVICE_B)
    active_commit = await _commit_as(
        client,
        active_token,
        DEVICE_B,
        vault_id,
        revision=2,
        sealedManifest=_sealed_manifest(),
    )
    assert active_commit.status_code == 200, active_commit.text

    # No row at all (legacy / newly claimed id) still writes: the bearer-only
    # gap stays open on purpose until ADR-015 §3 (signed writes).
    new_token = await _login(client, email, DEVICE_NEW)
    new_commit = await _commit_as(
        client,
        new_token,
        DEVICE_NEW,
        vault_id,
        revision=3,
        sealedManifest=_sealed_manifest(),
    )
    assert new_commit.status_code == 200, new_commit.text


async def test_revoke_scope_is_per_vault(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    other_vault = await _vault(client, owner)
    relogged = await _login(client, email, DEVICE_A)

    # DEVICE_A has no row in the second vault, so it may still write there.
    written = await _commit_as(client, relogged, DEVICE_A, other_vault)
    assert written.status_code == 200, written.text


async def test_foreign_vault_remains_404(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    _, stranger = await _signup(client, _email())
    foreign_vault = await _vault(client, stranger)
    relogged = await _login(client, email, DEVICE_A)

    denied = await _commit_as(client, relogged, DEVICE_A, foreign_vault)
    assert denied.status_code == 404, denied.text


async def test_self_revoke_is_allowed_then_followup_is_denied(client):
    email, owner = await _signup(client)
    vault_id = await _vault(client, owner)
    assert (
        await client.post(
            f"/api/v1/vaults/{vault_id}/devices",
            headers=_auth(owner),
            json={"deviceId": DEVICE_C, "label": "Self revoking"},
        )
    ).status_code == 200
    token = await _login(client, email, DEVICE_C)
    assert (
        await _commit_as(client, token, DEVICE_C, vault_id)
    ).status_code == 200

    self_revoke = await client.delete(
        f"/api/v1/vaults/{vault_id}/devices/{DEVICE_C}", headers=_h(token, DEVICE_C)
    )
    assert self_revoke.status_code == 200, self_revoke.text

    followup = await _commit_as(
        client,
        token,
        DEVICE_C,
        vault_id,
        revision=2,
        sealedManifest=_sealed_manifest(),
    )
    assert followup.status_code == 403, followup.text


async def _vault_with_active_device(client):
    """Owner + vault + active DEVICE_A row + a valid DEVICE_A session."""
    email, owner = await _signup(client)
    vault_id = await _vault(client, owner)
    first = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=_auth(owner),
        json={
            "revision": 1,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "envelopes": [_master_envelope(), _device_envelope(DEVICE_A)],
            "entries": [],
        },
    )
    assert first.status_code == 200, first.text
    registered = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(owner),
        json={"deviceId": DEVICE_A, "label": "Active phone"},
    )
    assert registered.status_code == 200, registered.text
    token = await _login(client, email, DEVICE_A)
    return email, owner, vault_id, token


class _Gate:
    """Barrier in front of the ASGI app for one device's snapshot request."""

    def __init__(self, app, device_id, admitted, release):
        self.app = app
        self.device_id = device_id
        self.admitted = admitted
        self.release = release

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"].endswith("/snapshots"):
            headers = {key.decode().lower(): value.decode() for key, value in scope["headers"]}
            if headers.get("x-device-id") == self.device_id:
                self.admitted.set()
                await self.release.wait()
        await self.app(scope, receive, send)


async def test_revoke_committed_before_guard_denies_the_write(client):
    """Barrier test: revoke commits first, then the admitted write checks the row."""
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    email, owner, vault_id, token = await _vault_with_active_device(client)
    admitted = asyncio.Event()
    release = asyncio.Event()
    async with AsyncClient(
        transport=ASGITransport(app=_Gate(app, DEVICE_A, admitted, release)),
        base_url="http://test",
    ) as gated:
        write = asyncio.create_task(
            gated.post(
                f"/api/v1/vaults/{vault_id}/snapshots",
                headers=_h(token, DEVICE_A),
                json={
                    "revision": 2,
                    "vaultKeyVersion": 1,
                    "cryptoProtocolVersion": 1,
                    "envelopes": [_master_envelope()],
                    "entries": [],
                    "sealedManifest": _sealed_manifest(),
                },
            )
        )
        await asyncio.wait_for(admitted.wait(), 2)
        # Self-revoke keeps this session token alive, so the DB row guard (not
        # only the session store) is what must deny the admitted write.
        revoked = await client.delete(
            f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", headers=_h(token, DEVICE_A)
        )
        assert revoked.status_code == 200, revoked.text
        release.set()
        response = await write
        assert response.status_code == 403, response.text


async def test_revoke_waits_for_an_admitted_write_lock(client):
    """Barrier test: the guard holds the vault lock until commit; revoke waits."""
    import app.api.routes.vaults as vault_routes

    email, owner, vault_id, token = await _vault_with_active_device(client)
    entered = asyncio.Event()
    release = asyncio.Event()
    original = vault_routes.commit_snapshot

    async def gated_commit(db, vault, payload):
        entered.set()
        await release.wait()
        return await original(db, vault, payload)

    vault_routes.commit_snapshot = gated_commit
    try:
        write = asyncio.create_task(
            _commit_as(
                client,
                token,
                DEVICE_A,
                vault_id,
                revision=2,
                sealedManifest=_sealed_manifest(),
            )
        )
        await asyncio.wait_for(entered.wait(), 2)
        revoke = asyncio.create_task(
            client.delete(
                f"/api/v1/vaults/{vault_id}/devices/{DEVICE_A}", headers=_auth(owner)
            )
        )
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(revoke), 0.3)
        release.set()
        write_response, revoke_response = await asyncio.gather(write, revoke)
        assert write_response.status_code == 200, write_response.text
        assert revoke_response.status_code == 200, revoke_response.text
    finally:
        vault_routes.commit_snapshot = original


async def test_revoked_device_cannot_consume_a_webauthn_challenge(client):
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    relogged = await _login(client, email, DEVICE_A)
    challenge_id = uuid.uuid4()
    response = await client.post(
        f"/api/v1/vaults/{vault_id}/webauthn/challenges/{challenge_id}/consume",
        headers=_h(relogged, DEVICE_A),
        json={
            "purpose": "assert",
            "challenge": base64.b64encode(b"\x00" * 32).decode("ascii"),
            "deviceId": DEVICE_A,
        },
    )
    assert response.status_code == 403, response.text


async def test_active_device_can_reenrol_a_revoked_id_by_design(client):
    """Documented residual: only the revoked device itself is blocked."""
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    registered = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_auth(owner),
        json={"deviceId": DEVICE_B, "label": "Active tablet"},
    )
    assert registered.status_code == 200, registered.text
    active = await _login(client, email, DEVICE_B)
    readded = await client.post(
        f"/api/v1/vaults/{vault_id}/devices",
        headers=_h(active, DEVICE_B),
        json={"deviceId": DEVICE_A, "label": "Re-enrolled by active device"},
    )
    assert readded.status_code == 200, readded.text
    assert readded.json()["revokedAt"] is None
    # The re-enrolled id can write again; this is the documented residual.
    relogged = await _login(client, email, DEVICE_A)
    write = await _commit_as(
        client,
        relogged,
        DEVICE_A,
        vault_id,
        revision=2,
        sealedManifest=_sealed_manifest(),
    )
    assert write.status_code == 200, write.text


async def test_revoke_globally_revokes_existing_sessions_but_login_stays_per_vault(client):
    """Vault-scoped guard, user+device session revoke: document both effects."""
    email, owner = await _signup(client)
    vault_a = await _vault(client, owner)
    vault_b = await _vault(client, owner)
    assert (
        await client.post(
            f"/api/v1/vaults/{vault_a}/devices",
            headers=_auth(owner),
            json={"deviceId": DEVICE_A, "label": "Cross-vault"},
        )
    ).status_code == 200
    token = await _login(client, email, DEVICE_A)
    first_b = await _commit_as(client, token, DEVICE_A, vault_b)
    assert first_b.status_code == 200, first_b.text

    revoked = await client.delete(
        f"/api/v1/vaults/{vault_a}/devices/{DEVICE_A}", headers=_auth(owner)
    )
    assert revoked.status_code == 200, revoked.text

    # The existing session is user+device-global, not vault-scoped: vault B now 401.
    stale_b = await _commit_as(
        client, token, DEVICE_A, vault_b, revision=2, sealedManifest=_sealed_manifest()
    )
    assert stale_b.status_code == 401, stale_b.text

    # Login is not globally locked; a fresh session can write vault B (no row there).
    fresh = await _login(client, email, DEVICE_A)
    write_b = await _commit_as(
        client, fresh, DEVICE_A, vault_b, revision=2, sealedManifest=_sealed_manifest()
    )
    assert write_b.status_code == 200, write_b.text


async def test_revoked_device_can_create_a_new_vault_account_operation(client):
    """Create-vault is account-scoped, not a mutation of the revoked vault."""
    email, owner, vault_id, _ = await _vault_with_revoked_device(client)
    relogged = await _login(client, email, DEVICE_A)
    created = await client.post("/api/v1/vaults", headers=_h(relogged, DEVICE_A))
    assert created.status_code == 201, created.text
    new_vault = created.json()["vaultId"]
    written = await _commit_as(
        client, relogged, DEVICE_A, new_vault, revision=1, sealedManifest=_sealed_manifest()
    )
    assert written.status_code == 200, written.text


async def test_old_owner_write_is_rechecked_after_a_concurrent_owner_transfer(client, engine):
    """Postgres: transfer commits during the lock wait -> old owner 404.
    SQLite: BEGIN IMMEDIATE serializes, so the old-owner write completes before
    the transfer and no write lands after it.
    """
    import uuid as _uuid

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api import deps as deps_module
    from app.models.user import User
    from app.models.vault import Vault

    email_a, owner_a = await _signup(client)
    vault_id = await _vault(client, owner_a)
    first = await client.post(
        f"/api/v1/vaults/{vault_id}/snapshots",
        headers=_auth(owner_a),
        json={
            "revision": 1,
            "vaultKeyVersion": 1,
            "cryptoProtocolVersion": 1,
            "envelopes": [_master_envelope(), _device_envelope(DEVICE_A)],
            "entries": [],
        },
    )
    assert first.status_code == 200, first.text
    assert (
        await client.post(
            f"/api/v1/vaults/{vault_id}/devices",
            headers=_auth(owner_a),
            json={"deviceId": DEVICE_A, "label": "Old owner phone"},
        )
    ).status_code == 200
    token_a = await _login(client, email_a, DEVICE_A)

    email_b, _ = await _signup(client)
    async with AsyncSession(bind=engine, expire_on_commit=False) as session:
        user_b = (
            await session.execute(select(User).where(User.email == email_b))
        ).scalar_one()

    entered = asyncio.Event()
    release = asyncio.Event()
    original = deps_module.lock_vault_row
    gated_once = False

    async def gated(db, vault_row_id):
        nonlocal gated_once
        if not gated_once:
            gated_once = True
            entered.set()
            await release.wait()
        return await original(db, vault_row_id)

    deps_module.lock_vault_row = gated
    try:
        write = asyncio.create_task(
            _commit_as(
                client,
                token_a,
                DEVICE_A,
                vault_id,
                revision=2,
                sealedManifest=_sealed_manifest(),
            )
        )
        await asyncio.wait_for(entered.wait(), 2)

        async def transfer_owner():
            async with AsyncSession(bind=engine, expire_on_commit=False) as session:
                row = await session.get(Vault, _uuid.UUID(vault_id))
                assert row is not None
                row.owner_user_id = user_b.id
                await session.commit()

        transfer = asyncio.create_task(transfer_owner())
        await asyncio.sleep(0.3)
        sqlite = engine.dialect.name == "sqlite"
        if sqlite:
            assert not transfer.done(), "SQLite writer lock should serialize the transfer"
        else:
            await asyncio.wait_for(transfer, 2)
        release.set()
        response = await write
        await asyncio.wait_for(transfer, 2)
        assert response.status_code == (200 if sqlite else 404), response.text
        async with AsyncSession(bind=engine, expire_on_commit=False) as session:
            row = await session.get(Vault, _uuid.UUID(vault_id))
            assert row is not None and row.owner_user_id == user_b.id
    finally:
        deps_module.lock_vault_row = original


async def test_two_adopters_real_db_engine_one_owner(engine, tmp_path, monkeypatch):
    """Postgres CI runs this on the real engine fixture; SQLite serializes earlier.

    Both requests read the LOCAL vault ids before the lock. B waits at the lock
    barrier, A commits the owner change, then B must see 409/no transfer. The
    frozen 174 code (id-only re-select) would transfer the Vault to B as well.
    """
    from uuid import UUID

    from httpx import ASGITransport, AsyncClient as HttpxAsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from app.api.routes import local_meta
    from app.api.routes.auth import LOCAL_ACCOUNT_EMAIL
    from app.core.config import get_settings
    from app.db.session import get_db
    from app.main import create_app
    from app.models.user import User
    from app.models.vault import Vault

    dist = tmp_path / "local-dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><title>local</title>", encoding="utf-8")
    monkeypatch.setenv("FOURALLPASS_PROFILE", "local")
    monkeypatch.setenv("FOURALLPASS_UI_DIST", str(dist))
    get_settings.cache_clear()
    local_app = create_app()
    factory = async_sessionmaker(
        bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False
    )

    async def override_get_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    local_app.dependency_overrides[get_db] = override_get_db
    try:
        async with AsyncSession(bind=engine, expire_on_commit=False) as session:
            local = User(email=LOCAL_ACCOUNT_EMAIL)
            session.add(local)
            await session.flush()
            vault = Vault(owner_user_id=local.id, crypto_protocol_version=1)
            session.add(vault)
            await session.commit()
            vault_id = str(vault.id)
            local_id = local.id

        async with HttpxAsyncClient(
            transport=ASGITransport(app=local_app), base_url="http://127.0.0.1:8788"
        ) as local_client:
            users = []
            for index, email in enumerate(("engine-adopt-a@example.com", "engine-adopt-b@example.com")):
                device = {"X-Device-Id": f"dev_engineadopt000000{index:03d}"}
                registered = await local_client.post(
                    "/api/v1/auth/register",
                    json={"email": email, "password": "account-password-1234"},
                    headers=device,
                )
                assert registered.status_code == 200, registered.text
                users.append({**device, "Authorization": f"Bearer {registered.json()['token']}"})

            original = local_meta.lock_vault_rows
            entered = asyncio.Event()
            release = asyncio.Event()
            calls = 0

            async def gated(db, vault_ids):
                nonlocal calls
                calls += 1
                if calls == 1:
                    entered.set()
                    await release.wait()
                return await original(db, vault_ids)

            local_meta.lock_vault_rows = gated
            try:
                first = asyncio.create_task(
                    local_client.post("/api/v1/local/adopt-local-vault", headers=users[1])
                )
                await asyncio.wait_for(entered.wait(), 2)
                second = asyncio.create_task(
                    local_client.post("/api/v1/local/adopt-local-vault", headers=users[0])
                )
                if engine.dialect.name == "sqlite":
                    # SQLite's BEGIN IMMEDIATE serializes before the second can
                    # select ids; let the gated adopter finish first.
                    release.set()
                    responses = await asyncio.gather(first, second)
                else:
                    # Postgres: the second adopter must actually commit the
                    # owner change while the first is held at the pre-lock gate.
                    second_response = await asyncio.wait_for(second, 10)
                    assert second_response.status_code == 200, second_response.text
                    assert second_response.json().get("vaultId") == vault_id
                    release.set()
                    first_response = await first
                    assert first_response.status_code == 409, first_response.text
                    assert first_response.json().get("detail") == "local_vault_changed"
                    responses = [first_response, second_response]
            finally:
                local_meta.lock_vault_rows = original

        assert all(response.status_code in {200, 409} for response in responses)
        winners = [
            response
            for response in responses
            if response.status_code == 200 and response.json().get("vaultId")
        ]
        assert len(winners) == 1, [response.text for response in responses]
        assert winners[0].json()["vaultId"] == vault_id
        winner_index = responses.index(winners[0])
        async with AsyncSession(bind=engine, expire_on_commit=False) as session:
            row = await session.get(Vault, UUID(vault_id))
            assert row is not None
            assert row.owner_user_id != local_id
            owner = await session.get(User, row.owner_user_id)
            assert owner is not None
            # winner_index 0 is user B, index 1 is user A
            expected_email = ("engine-adopt-b@example.com", "engine-adopt-a@example.com")[winner_index]
            assert owner.email == expected_email
    finally:
        local_app.dependency_overrides.clear()
        get_settings.cache_clear()
