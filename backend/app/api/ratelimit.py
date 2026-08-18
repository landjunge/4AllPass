"""IP-bucketed request rate limits. Never keyed on secrets."""

from __future__ import annotations

from fastapi import HTTPException, Request, status

from app.core.config import get_settings
from app.core.sessions import SessionStore

_AUTH_ACTIONS = frozenset({"login", "register"})


def client_bucket(request: Request, action: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"{action}:{ip}"


async def enforce_rate_limit(store: SessionStore, request: Request, action: str) -> None:
    settings = get_settings()
    if action in _AUTH_ACTIONS:
        limit = settings.auth_login_rate_limit
        window = settings.auth_login_rate_window_seconds
    else:
        limit = settings.auth_write_rate_limit
        window = settings.auth_write_rate_window_seconds
    if await store.hit_rate_limit(client_bucket(request, action), limit, window):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="too many attempts")
