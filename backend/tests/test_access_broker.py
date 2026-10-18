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
        assert res.json()["reason"] == "handoff_unavailable"
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


@pytest.mark.parametrize("mode", [None, "raw_secret", "mediated", "export"])
async def test_all_legacy_modes_fail_closed_without_queueing(local_app, mode, caplog):
    runtime, app = local_app
    await _create_schema()
    async with AsyncClient(transport=ASGITransport(app=app), base_url=runtime.origin) as client:
        body = {"application": "n8n", "provider": "GitHub", "scope": ["repository.read"], "ttl": 15}
        if mode is not None:
            body["handoff"] = mode
        response = await client.post("/v1/access/request", headers={"Authorization": f"Bearer {runtime.broker_token}"}, json=body)
        assert response.json() == {"status": "denied", "reason": "handoff_unavailable"}
        assert app.state.broker.queue.empty()
        assert not app.state.broker.waiting
        assert SECRET not in caplog.text


async def test_stale_ui_decision_cannot_forward_material(local_app, caplog):
    runtime, app = local_app
    await _create_schema()
    pending = asyncio.get_running_loop().create_future()
    app.state.broker.waiting["synthetic_legacy"] = pending
    async with AsyncClient(transport=ASGITransport(app=app), base_url=runtime.origin) as client:
        response = await client.post("/v1/broker/decide", headers={"Authorization": f"Bearer {runtime.broker_token}", "Origin": UI_ORIGIN}, json={"id": "synthetic_legacy", "body": {"status": "approved", "access_token": SECRET, "error": SECRET}})
        assert response.status_code == 200
        assert pending.result() == {"status": "denied", "reason": "handoff_unavailable"}
        assert SECRET not in caplog.text
        app.state.broker.waiting.clear()
