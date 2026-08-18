from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, devices, health, vaults
from app.core.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        description=(
            "4AllPass — self-hosted Zero-Knowledge password manager backend. "
            "This service never sees plaintext vault entries or key material; "
            "see docs/crypto-protocol.md and docs/threat-model.md."
        ),
        version="0.1.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(vaults.router, prefix="/api/v1")
    app.include_router(devices.router, prefix="/api/v1")

    return app


app = create_app()
