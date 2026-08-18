from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic.alias_generators import to_camel

from app.api.router import api_router
from app.config import Settings, get_settings
from app.db import dispose_engine
from app.errors import ApiError
from app.redis_client import close_redis

DESCRIPTION = """
Zero-knowledge storage backend for 4AllPass.

The server stores wrapped key envelopes, encrypted entries, and device metadata.
It never sees a master password, a vault key, a device key, WebAuthn PRF output,
or any plaintext entry data.
""".strip()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await dispose_engine()
    await close_redis()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title="4AllPass API",
        description=DESCRIPTION,
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(api_router, prefix=settings.api_prefix)

    @app.exception_handler(ApiError)
    async def api_error_handler(_: Request, error: ApiError) -> JSONResponse:
        body: dict[str, object] = {"detail": error.detail}
        body.update(
            {to_camel(key): value for key, value in error.extra.items() if value is not None}
        )
        return JSONResponse(status_code=error.status_code, content=body)

    return app


app = create_app()
