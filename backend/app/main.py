from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api.routes import auth, devices, health, local_meta, vaults, webauthn
from app.broker import BrokerHub, router as broker_router
from app.core.config import get_settings
from app.body_limit import BodyLimitMiddleware


def loopback_connect_origin(url: str) -> str:
    """CSP connect-src: this process's loopback origin, never * and never a remote host."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if parsed.scheme != "http" or host not in {"127.0.0.1", "localhost"}:
        return "http://127.0.0.1:8788"
    try:
        port = parsed.port
    except ValueError:
        return "http://127.0.0.1:8788"
    if port is None:
        port = 80
    return f"http://127.0.0.1:{port}"


def local_csp(origin: str) -> bytes:
    connect = loopback_connect_origin(origin)
    return (
        "default-src 'self'; "
        f"connect-src 'self' {connect}; "
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self' 'wasm-unsafe-eval'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'; "
        "form-action 'self'"
    ).encode()


class LoopbackHostMiddleware:
    """Local profile: refuse unexpected Host values (DNS rebinding)."""

    allowed = {"127.0.0.1", "localhost", "::1"}

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        host = (headers.get("host") or "").split(":", 1)[0].strip("[]").lower()
        if host and host not in self.allowed:
            await send(
                {
                    "type": "http.response.start",
                    "status": 400,
                    "headers": [(b"content-type", b"application/json")],
                }
            )
            await send({"type": "http.response.body", "body": b'{"detail":"invalid host"}'})
            return
        await self.app(scope, receive, send)


class SecurityHeadersMiddleware:
    """Same headers as frontend/nginx.conf. Local profile only."""

    def __init__(self, app: ASGIApp, origin: str = "http://127.0.0.1:8788") -> None:
        self.app = app
        self.csp = local_csp(origin)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")

        async def send_wrapped(message: dict) -> None:
            if message["type"] == "http.response.start":
                extra = {
                    b"x-frame-options": b"DENY",
                    b"x-content-type-options": b"nosniff",
                    b"referrer-policy": b"no-referrer",
                    b"cross-origin-opener-policy": b"same-origin",
                    b"content-security-policy": self.csp,
                }
                if path == "/sw.js" or path.endswith("/sw.js"):
                    extra[b"cache-control"] = b"no-cache, no-store, must-revalidate"
                elif path.startswith("/assets/"):
                    extra[b"cache-control"] = b"public, max-age=31536000, immutable"
                raw: list[tuple[bytes, bytes]] = list(message.get("headers", []))
                present = {k.lower() for k, _ in raw}
                for key, value in extra.items():
                    if key not in present:
                        raw.append((key, value))
                message = {**message, "headers": raw}
            await send(message)

        await self.app(scope, receive, send_wrapped)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    if settings.database_url.startswith("sqlite"):
        from app.db.base import Base
        from app.db.session import get_engine

        async with get_engine().begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    yield


def _mount_local_ui(app: FastAPI, dist: Path) -> None:
    index = dist / "index.html"
    if not dist.is_dir() or not index.is_file():
        @app.get("/")
        async def ui_missing() -> JSONResponse:
            return JSONResponse(
                {
                    "detail": "UI build missing. Run npm run build, then python -m app.local.",
                    "path": str(dist),
                },
                status_code=503,
            )

        return

    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="ui-assets")

    @app.get("/sw.js")
    async def service_worker() -> Response:
        sw = dist / "sw.js"
        if not sw.is_file():
            return Response(status_code=404)
        return FileResponse(
            sw,
            media_type="application/javascript",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )

    @app.get("/{full_path:path}")
    async def spa(full_path: str) -> Response:
        if full_path.startswith("api/") or full_path.startswith("v1/"):
            return JSONResponse({"detail": "not found"}, status_code=404)
        candidate = dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index)


def create_app() -> FastAPI:
    settings = get_settings()
    if settings.environment == "production" and settings.session_secret_is_insecure_default():
        raise RuntimeError(
            "FOURALLPASS_SESSION_SECRET must be set to a non-default value in production"
        )

    app = FastAPI(
        title=settings.app_name,
        description=(
            "4AllPass — self-hosted Zero-Knowledge password manager backend. "
            "This service never sees plaintext vault entries or key material; "
            "see docs/crypto-protocol.md and docs/threat-model.md."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    cors_origins = list(settings.cors_origins)
    if settings.is_local():
        for extra in ("http://tauri.localhost", "https://tauri.localhost"):
            if extra not in cors_origins:
                cors_origins.append(extra)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(BodyLimitMiddleware)
    if settings.is_local():
        app.add_middleware(LoopbackHostMiddleware)
        app.add_middleware(
            SecurityHeadersMiddleware,
            origin=settings.broker_url or "http://127.0.0.1:8788",
        )

    app.include_router(health.router)
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(local_meta.router, prefix="/api/v1")
    app.include_router(vaults.router, prefix="/api/v1")
    app.include_router(devices.router, prefix="/api/v1")
    app.include_router(webauthn.router, prefix="/api/v1")

    if settings.is_local() and settings.broker_token:
        app.state.broker = BrokerHub(settings.broker_token, settings.cors_origins)
        app.include_router(broker_router)

    if settings.is_local():
        dist = Path(settings.ui_dist) if settings.ui_dist else None
        if dist is None:
            from app.core.paths import default_ui_dist

            dist = default_ui_dist()
        _mount_local_ui(app, dist)

    return app


app = create_app()
