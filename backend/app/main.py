from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, devices, health, vaults
from app.core.config import get_settings
from app.core.origin import SameOriginMiddleware


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        description=(
            "4AllPass — self-hosted Zero-Knowledge password manager backend. "
            "This service never sees plaintext vault entries or key material; "
            "see docs/crypto-protocol.md and docs/threat-model.md. Its job is "
            "identity, authorization and encrypted-blob storage — the security "
            "boundary is described in docs/backend-security-boundary.md."
        ),
        version="0.1.0",
    )

    # Order matters: middleware added last is outermost, so CORS wraps the
    # origin check and a rejected cross-origin request still comes back with
    # CORS headers instead of surfacing in the browser as an opaque error.
    app.add_middleware(SameOriginMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(vaults.router)
    app.include_router(devices.router)

    return app


app = create_app()
