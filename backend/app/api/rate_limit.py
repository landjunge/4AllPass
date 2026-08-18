"""IP-bucket rate limits for obvious brute-force and write-abuse paths.

This is not a WAF. It only caps registration, login, device metadata, and
snapshot writes so a single IP cannot cheaply hammer those endpoints.
"""

from __future__ import annotations

from fastapi import HTTPException, Request, status

from app.core.config import get_settings
from app.core.sessions import SessionStore


def client_bucket(request: Request, action: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{action}:{ip}"


async def enforce_rate_limit(
    store: SessionStore,
    request: Request,
    action: str,
    *,
    limit: int | None = None,
    window_seconds: int | None = None,
) -> None:
    settings = get_settings()
    if await store.hit_rate_limit(
        client_bucket(request, action),
        settings.auth_login_rate_limit if limit is None else limit,
        settings.auth_login_rate_window_seconds if window_seconds is None else window_seconds,
    ):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too many attempts")


async def enforce_write_rate_limit(store: SessionStore, request: Request, action: str) -> None:
    settings = get_settings()
    await enforce_rate_limit(
        store,
        request,
        action,
        limit=settings.write_rate_limit,
        window_seconds=settings.write_rate_window_seconds,
    )
