"""Local profile: one origin, SQLite file, generated session secret, static UI."""

from __future__ import annotations

from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import get_engine, reset_engine
from app.local import port_held, prepare_local_runtime
from app.main import create_app, loopback_connect_origin


async def _create_schema() -> None:
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    yield
    get_settings.cache_clear()
    reset_engine()


def _write_ui(dist: Path) -> None:
    dist.mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>4AllPass</title>ok", encoding="utf-8")
    (dist / "sw.js").write_text("// sw", encoding="utf-8")
    assets = dist / "assets"
    assets.mkdir()
    (assets / "app.js").write_text("console.log('x')", encoding="utf-8")


def _activate(runtime, monkeypatch) -> None:
    # monkeypatch first so teardown restores the previous process env.
    monkeypatch.setenv("FOURALLPASS_PROFILE", "local")
    monkeypatch.setenv("FOURALLPASS_DATABASE_URL", runtime.database_url)
    monkeypatch.setenv("FOURALLPASS_SESSION_BACKEND", "memory")
    monkeypatch.setenv("FOURALLPASS_SESSION_SECRET", runtime.session_secret)
    monkeypatch.setenv("FOURALLPASS_ENVIRONMENT", "local")
    monkeypatch.setenv("FOURALLPASS_WEBAUTHN_RP_ID", "127.0.0.1")
    monkeypatch.setenv("FOURALLPASS_UI_DIST", str(runtime.ui_dist))
    monkeypatch.setenv("FOURALLPASS_CORS_ORIGINS", f'["{runtime.origin}"]')
    monkeypatch.setenv("FOURALLPASS_DATA_DIR", str(runtime.data_dir))
    monkeypatch.setenv("FOURALLPASS_BROKER_TOKEN", runtime.broker_token)
    monkeypatch.setenv("FOURALLPASS_BROKER_URL", runtime.origin)
    get_settings.cache_clear()
    reset_engine()


@pytest.fixture
def local_runtime(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    _write_ui(dist)
    runtime = prepare_local_runtime(data_dir=tmp_path / "data", ui_dist=dist, port=8788)
    _activate(runtime, monkeypatch)
    yield runtime
    get_settings.cache_clear()
    reset_engine()


def test_prepare_local_runtime_persists_secret_and_sqlite(tmp_path):
    first = prepare_local_runtime(data_dir=tmp_path / "data", ui_dist=tmp_path / "missing")
    assert first.database_url.startswith("sqlite+aiosqlite:///")
    assert first.database_path.name == "vault.db"
    assert len(first.session_secret) >= 32
    secret_file = tmp_path / "data" / "session.secret"
    assert secret_file.is_file()
    second = prepare_local_runtime(data_dir=tmp_path / "data")
    assert second.session_secret == first.session_secret
    assert first.origin == "http://127.0.0.1:8788"
    assert first.broker_token
    assert (tmp_path / "data" / "broker.token").is_file()
    assert second.broker_token == first.broker_token


def test_loopback_connect_origin_is_this_process_not_star():
    assert loopback_connect_origin("http://127.0.0.1:8794") == "http://127.0.0.1:8794"
    assert loopback_connect_origin("http://localhost:8788") == "http://127.0.0.1:8788"
    assert loopback_connect_origin("https://evil.example") == "http://127.0.0.1:8788"
    assert loopback_connect_origin("http://127.0.0.1:*") == "http://127.0.0.1:8788"


def test_local_rejects_non_loopback(tmp_path):
    with pytest.raises(ValueError, match="loopback"):
        prepare_local_runtime(data_dir=tmp_path, host="0.0.0.0")


def test_port_held_false_for_unused():
    assert port_held("127.0.0.1", 1) is False


@pytest.mark.asyncio(loop_scope="session")
async def test_local_app_serves_ui_and_api_same_origin(local_runtime):
    await _create_schema()
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=local_runtime.origin) as client:
        page = await client.get("/")
        assert page.status_code == 200
        assert "4AllPass" in page.text
        assert page.headers["x-frame-options"] == "DENY"
        assert page.headers["x-content-type-options"] == "nosniff"
        assert page.headers["referrer-policy"] == "no-referrer"
        csp = page.headers["content-security-policy"]
        assert "default-src 'self'" in csp
        assert "connect-src 'self' http://127.0.0.1:8788" in csp
        assert "http://127.0.0.1:*" not in csp
        assert "https:" not in csp.split("connect-src")[1].split(";")[0]

        sw = await client.get("/sw.js")
        assert sw.status_code == 200
        assert "no-store" in sw.headers["cache-control"]

        spa = await client.get("/vault")
        assert spa.status_code == 200
        assert "4AllPass" in spa.text

        asset = await client.get("/assets/app.js")
        assert asset.status_code == 200

        health = await client.get("/api/v1/health")
        assert health.status_code == 200
        body = health.json()
        assert body["profile"] == "local"
        assert body["database"] is True
        assert body["webauthn_rp_id"] == "127.0.0.1"
        assert "password" not in str(body).lower()
        assert "secret" not in str(body).lower()

        foreign = await client.get("/api/v1/health", headers={"Host": "evil.example"})
        assert foreign.status_code == 400


@pytest.mark.asyncio(loop_scope="session")
async def test_local_bootstrap_mints_session_without_register(local_runtime):
    await _create_schema()
    app = create_app()
    transport = ASGITransport(app=app)
    device = {"X-Device-Id": "dev_localappdevice000000001"}
    async with AsyncClient(transport=transport, base_url=local_runtime.origin) as client:
        missing_device = await client.post("/api/v1/auth/local")
        assert missing_device.status_code == 400
        first = await client.post("/api/v1/auth/local", headers=device)
        assert first.status_code == 200, first.text
        body = first.json()
        assert body["email"] == "local@127.0.0.1"
        assert body["token"]
        assert "password" not in body
        second = await client.post("/api/v1/auth/local", headers=device)
        assert second.status_code == 200
        assert second.json()["accountId"] == body["accountId"]
        me = await client.get(
            "/api/v1/auth/me",
            headers={**device, "Authorization": f"Bearer {body['token']}"},
        )
        assert me.status_code == 200
        assert me.json()["email"] == "local@127.0.0.1"


@pytest.mark.asyncio(loop_scope="session")
async def test_local_broker_info_is_pairing_token_not_a_vault_secret(local_runtime):
    await _create_schema()
    app = create_app()
    transport = ASGITransport(app=app)
    device = {"X-Device-Id": "dev_localappdevice000000001"}
    async with AsyncClient(transport=transport, base_url=local_runtime.origin) as client:
        denied = await client.get("/api/v1/local/broker", headers=device)
        assert denied.status_code == 401
        session = (
            await client.post("/api/v1/auth/local", headers=device)
        ).json()
        info = await client.get(
            "/api/v1/local/broker",
            headers={**device, "Authorization": f"Bearer {session['token']}"},
        )
        assert info.status_code == 200, info.text
        body = info.json()
        assert body["url"] == local_runtime.origin
        assert body["token"] == local_runtime.broker_token
        assert "password" not in body
        assert "ghp_" not in str(body)


@pytest.mark.asyncio(loop_scope="session")
async def test_local_webview_caps_store_no_secrets(local_runtime):
    await _create_schema()
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url=local_runtime.origin) as client:
        missing = await client.get("/api/v1/local/webview-caps")
        assert missing.status_code == 404
        posted = await client.post(
            "/api/v1/local/webview-caps",
            json={
                "publicKeyCredential": True,
                "credentialsCreate": True,
                "platformAuthenticator": False,
                "prf": None,
            },
        )
        assert posted.status_code == 200, posted.text
        body = posted.json()
        assert body["publicKeyCredential"] is True
        assert body["prf"] is None
        assert "password" not in body
        got = await client.get("/api/v1/local/webview-caps")
        assert got.json()["credentialsCreate"] is True


@pytest.mark.asyncio(loop_scope="session")
async def test_local_without_ui_build_is_503_not_a_token(tmp_path, monkeypatch):
    runtime = prepare_local_runtime(data_dir=tmp_path / "data", ui_dist=tmp_path / "no-dist")
    _activate(runtime, monkeypatch)
    await _create_schema()
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://127.0.0.1:8788") as client:
        missing = await client.get("/")
        assert missing.status_code == 503
        assert "token" not in missing.text.lower()
        assert (await client.get("/health")).status_code == 200
