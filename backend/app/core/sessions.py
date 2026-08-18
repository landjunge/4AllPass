import json
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import Response
from pydantic import BaseModel
from redis.asyncio import Redis

from app.core.config import Settings


class SessionData(BaseModel):
    """Server-side session payload stored in Redis."""

    user_id: uuid.UUID
    created_at: datetime
    last_active_at: datetime


def generate_session_token() -> str:
    """Generate a high-entropy cryptographically secure random session token."""
    return secrets.token_urlsafe(32)


def _session_key(token: str) -> str:
    return f"session:{token}"


async def create_session(
    redis: Redis,
    user_id: uuid.UUID,
    ttl_seconds: int,
) -> str:
    """Create a new server-side session in Redis."""
    token = generate_session_token()
    now = datetime.now(timezone.utc)
    session_data = SessionData(
        user_id=user_id,
        created_at=now,
        last_active_at=now,
    )
    payload = session_data.model_dump_json()
    await redis.set(_session_key(token), payload, ex=ttl_seconds)
    return token


async def get_session(redis: Redis, token: str) -> SessionData | None:
    """Retrieve session data from Redis if valid and not expired."""
    if not token:
        return None
    raw_data: Any = await redis.get(_session_key(token))
    if not raw_data:
        return None
    try:
        if isinstance(raw_data, bytes):
            raw_data = raw_data.decode("utf-8")
        data_dict = json.loads(raw_data)
        return SessionData.model_validate(data_dict)
    except Exception:
        return None


async def delete_session(redis: Redis, token: str) -> bool:
    """Revoke a session in Redis."""
    if not token:
        return False
    deleted = await redis.delete(_session_key(token))
    return bool(deleted > 0)


def set_session_cookie(
    response: Response,
    token: str,
    settings: Settings,
) -> None:
    """Attach the session token as a secure, HttpOnly cookie on the response."""
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        secure=settings.is_cookie_secure,
        samesite=settings.session_cookie_samesite,
        domain=settings.session_cookie_domain,
        path="/",
    )


def clear_session_cookie(
    response: Response,
    settings: Settings,
) -> None:
    """Clear the session cookie on the response."""
    response.delete_cookie(
        key=settings.session_cookie_name,
        domain=settings.session_cookie_domain,
        path="/",
        httponly=True,
        secure=settings.is_cookie_secure,
        samesite=settings.session_cookie_samesite,
    )
