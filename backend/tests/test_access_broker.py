"""In-process access relay (local profile). Never a vault decrypt."""

from __future__ import annotations

import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.db.session import reset_engine
from app.local import prepare_local_runtime
from app.main import create_app

from tests.test_local import _activate, _create_schema

pytestmark = pytest.mark.asyncio(loop_scope="session")

DEVICE = {"X-Device-Id": "dev_localappdevice000000001"}
UI_ORIGIN = "http://127.0.0.1:8788"
SECRET = "ghp_live-secret-must-not-log"


@pytest.fixture
def local_app(tmp_path, monkeypatch):
    runtime = prepare_local_runtime(data_dir=tmp_path / "data", ui_dist=tmp_path / "no-dist")
    _activate(runtime, monkeypatch)
    get_settings.cache_clear()
    reset_engine()
    app = create_app()
    return runtime, app


async def test_grant_without_ui_is_vault_locked(local_app):
    runtime, app = local_app
    await _create_schema()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=runtime.origin) as client:
        res = await client.post(
            "/v1/access/request",
            headers={"Authorization": f"Bearer {runtime.broker_token}"},
            json={"application": "n8n", "provider": "GitHub", "scope": ["repository.read"], "ttl": 15},
        )
        assert res.status_code == 200
        assert res.json()["status"] == "denied"
        assert res.json()["reason"] == "vault_locked"
        assert "access_token" not in res.json()


async def test_null_origin_on_grant_is_403(local_app):
    runtime, app = local_app
    await _create_schema()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=runtime.origin) as client:
        res = await client.post(
            "/v1/access/request",
            headers={
                "Authorization": f"Bearer {runtime.broker_token}",
                "Origin": "null",
            },
            json={"application": "n8n", "provider": "GitHub", "scope": ["repository.read"], "ttl": 15},
        )
        assert res.status_code == 403


async def test_browser_origin_on_grant_is_403(local_app):
    runtime, app = local_app
    await _create_schema()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=runtime.origin) as client:
        res = await client.post(
            "/v1/access/request",
            headers={
                "Authorization": f"Bearer {runtime.broker_token}",
                "Origin": "https://evil.example",
            },
            json={"application": "n8n", "provider": "GitHub", "scope": ["repository.read"], "ttl": 15},
        )
        assert res.status_code == 403


async def test_wrong_pairing_token_is_401(local_app):
    runtime, app = local_app
    await _create_schema()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=runtime.origin) as client:
        res = await client.post(
            "/v1/access/request",
            headers={"Authorization": "Bearer wrong"},
            json={"application": "n8n", "provider": "GitHub", "scope": ["repository.read"], "ttl": 15},
        )
        assert res.status_code == 401


async def test_abandoned_poller_does_not_eat_the_next_grant(local_app):
    """A closed tab must not dequeue the next POST /v1/access/request."""
    runtime, app = local_app
    await _create_schema()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=runtime.origin) as client:
        auth = {"Authorization": f"Bearer {runtime.broker_token}"}
        stale = asyncio.create_task(
            client.get("/v1/broker/poll", headers={**auth, "Origin": UI_ORIGIN}),
        )
        await asyncio.sleep(0.1)
        stale.cancel()
        with pytest.raises(asyncio.CancelledError):
            await stale
        await asyncio.sleep(0.15)

        async def poll():
            return await client.get("/v1/broker/poll", headers={**auth, "Origin": UI_ORIGIN})

        poll_task = asyncio.create_task(poll())
        await asyncio.sleep(0.05)
        grant_task = asyncio.create_task(
            client.post(
                "/v1/access/request",
                headers=auth,
                json={
                    "application": "n8n",
                    "provider": "GitHub",
                    "scope": ["repository.read"],
                    "ttl": 15,
                },
            )
        )
        incoming = await poll_task
        assert incoming.status_code == 200, incoming.text
        body = incoming.json()
        decide = await client.post(
            "/v1/broker/decide",
            headers={**auth, "Origin": UI_ORIGIN},
            json={
                "v": 1,
                "id": body["id"],
                "body": {"status": "approved", "access_token": SECRET, "expires_in": 15},
            },
        )
        assert decide.status_code == 200
        granted = await grant_task
        assert granted.json()["status"] == "approved"
        assert granted.json()["access_token"] == SECRET


async def test_allow_flow_does_not_log_secret(local_app, caplog):
    runtime, app = local_app
    await _create_schema()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=runtime.origin) as client:
        auth = {"Authorization": f"Bearer {runtime.broker_token}"}

        async def poll():
            return await client.get("/v1/broker/poll", headers={**auth, "Origin": UI_ORIGIN})

        poll_task = asyncio.create_task(poll())
        await asyncio.sleep(0.05)
        grant_task = asyncio.create_task(
            client.post(
                "/v1/access/request",
                headers=auth,
                json={
                    "application": "n8n",
                    "provider": "GitHub",
                    "scope": ["repository.read"],
                    "ttl": 15,
                },
            )
        )
        incoming = await poll_task
        assert incoming.status_code == 200, incoming.text
        body = incoming.json()
        assert body["method"] == "POST /v1/access/request"
        decide = await client.post(
            "/v1/broker/decide",
            headers={**auth, "Origin": UI_ORIGIN},
            json={
                "v": 1,
                "id": body["id"],
                "body": {"status": "approved", "access_token": SECRET, "expires_in": 15},
            },
        )
        assert decide.status_code == 200
        granted = await grant_task
        assert granted.json()["status"] == "approved"
        assert granted.json()["access_token"] == SECRET
        assert SECRET not in caplog.text


async def _complete_grant(client, runtime, secret=SECRET):
    auth = {"Authorization": f"Bearer {runtime.broker_token}"}

    async def poll():
        return await client.get("/v1/broker/poll", headers={**auth, "Origin": UI_ORIGIN})

    poll_task = asyncio.create_task(poll())
    await asyncio.sleep(0.05)
    grant_task = asyncio.create_task(
        client.post(
            "/v1/access/request",
            headers=auth,
            json={
                "application": "n8n",
                "provider": "GitHub",
                "scope": ["repository.read"],
                "ttl": 15,
            },
        )
    )
    incoming = await poll_task
    assert incoming.status_code == 200, incoming.text
    body = incoming.json()
    decide = await client.post(
        "/v1/broker/decide",
        headers={**auth, "Origin": UI_ORIGIN},
        json={
            "v": 1,
            "id": body["id"],
            "body": {"status": "approved", "access_token": secret, "expires_in": 15},
        },
    )
    granted = await grant_task
    return auth, body["id"], decide, granted


async def test_second_decide_same_id_is_404(local_app):
    """An approved grant is one-shot. Replaying decide does not reissue the secret."""
    runtime, app = local_app
    await _create_schema()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=runtime.origin) as client:
        auth, req_id, decide, granted = await _complete_grant(client, runtime)
        assert decide.status_code == 200
        assert granted.json()["access_token"] == SECRET
        replay = await client.post(
            "/v1/broker/decide",
            headers={**auth, "Origin": UI_ORIGIN},
            json={
                "v": 1,
                "id": req_id,
                "body": {"status": "approved", "access_token": SECRET, "expires_in": 15},
            },
        )
        assert replay.status_code == 404
        assert replay.json().get("access_token") != SECRET


async def test_approved_grant_cannot_be_repulled(local_app):
    """After the agent receives the secret, a new POST without a listener is vault_locked."""
    runtime, app = local_app
    await _create_schema()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=runtime.origin) as client:
        auth, _req_id, _decide, granted = await _complete_grant(client, runtime)
        assert granted.json()["status"] == "approved"
        again = await client.post(
            "/v1/access/request",
            headers=auth,
            json={
                "application": "n8n",
                "provider": "GitHub",
                "scope": ["repository.read"],
                "ttl": 15,
            },
        )
        assert again.status_code == 200
        assert again.json()["status"] == "denied"
        assert again.json()["reason"] == "vault_locked"
        assert "access_token" not in again.json()
