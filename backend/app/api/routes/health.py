from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import RedisDep, SessionDep, SettingsDep
from app.models.base import CRYPTO_PROTOCOL_VERSION

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    database: bool
    redis: bool
    crypto_protocol_version: int
    webauthn_rp_id: str


@router.get("/health", response_model=HealthResponse)
async def health(session: SessionDep, redis: RedisDep, settings: SettingsDep) -> HealthResponse:
    database_ok = True
    redis_ok = True
    try:
        await session.execute(text("SELECT 1"))
    except Exception:
        database_ok = False
    try:
        await redis.ping()
    except Exception:
        redis_ok = False
    return HealthResponse(
        status="ok" if database_ok and redis_ok else "degraded",
        database=database_ok,
        redis=redis_ok,
        crypto_protocol_version=CRYPTO_PROTOCOL_VERSION,
        webauthn_rp_id=settings.webauthn_rp_id,
    )
