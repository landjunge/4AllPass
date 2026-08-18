from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.config import get_settings
from app.core.sessions import get_session_store

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/db")
async def health_db(db: AsyncSession = Depends(get_db)) -> dict[str, str]:
    await db.execute(text("SELECT 1"))
    return {"status": "ok"}


@router.get("/api/v1/health")
async def health_v1(db: AsyncSession = Depends(get_db)) -> dict[str, object]:
    settings = get_settings()
    database = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        database = False
    redis_ok = True
    if settings.session_backend == "redis":
        try:
            from app.db.redis import get_redis_client

            await get_redis_client().ping()
        except Exception:  # noqa: BLE001
            redis_ok = False
    else:
        get_session_store()
    return {
        "status": "ok" if database else "degraded",
        "database": database,
        "redis": redis_ok,
        "webauthn_rp_id": settings.webauthn_rp_id,
    }
