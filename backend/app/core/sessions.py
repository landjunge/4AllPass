"""Server-side session store and the cookie that carries a session token.

Design decision (docs/backend-security-boundary.md §2): sessions are opaque
random tokens in an ``HttpOnly`` cookie, with all state held server-side in
Postgres. No JWT, and no session signing secret.

The reasons, in order of weight:

* **Revocation is the point.** Logout, "sign out everywhere" and disabling an
  account must take effect on the next request. A stateless token cannot do
  that without a revocation list, which is the session table again with extra
  steps.
* **Nothing to leak.** The row stores SHA-256 of the token, never the token,
  so a database dump yields no usable credential.
* **No key management.** There is no signing key to rotate, distribute or
  accidentally commit — one fewer secret in a self-hosted deployment.
* **One durable store.** Redis stays for ephemeral state (rate limiting,
  WebAuthn challenges); a Redis restart must not sign every user out.

``HttpOnly`` also keeps the token out of reach of the vault code: script on
the page cannot read it, and it is never placed in ``localStorage`` or a URL.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import Request, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.config import Settings, get_settings
from app.core.security import (
    SESSION_TOKEN_MAX_CHARS,
    generate_session_token,
    hash_session_token,
)
from app.models.session import UserSession
from app.models.user import User

USER_AGENT_SUMMARY_MAX_CHARS = 512


def read_session_cookie(request: Request) -> str | None:
    """Read the session token out of the request cookie, if it looks like one at all."""
    token = request.cookies.get(get_settings().session_cookie_name)
    if not token or len(token) > SESSION_TOKEN_MAX_CHARS:
        return None
    return token


def set_session_cookie(response: Response, token: str, *, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_seconds,
        path=settings.session_cookie_path,
        domain=settings.session_cookie_domain,
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.session_cookie_samesite,
    )


def clear_session_cookie(response: Response, *, settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    response.delete_cookie(
        key=settings.session_cookie_name,
        path=settings.session_cookie_path,
        domain=settings.session_cookie_domain,
        secure=settings.cookie_secure,
        httponly=True,
        samesite=settings.session_cookie_samesite,
    )


def summarize_user_agent(request: Request) -> str | None:
    user_agent = request.headers.get("user-agent")
    if not user_agent:
        return None
    return user_agent[:USER_AGENT_SUMMARY_MAX_CHARS]


async def create_session(
    db: AsyncSession, user: User, *, user_agent_summary: str | None = None
) -> tuple[UserSession, str]:
    """Mint a fresh session for ``user`` and return it together with its raw token.

    The token is returned exactly once, to be written into the response cookie.
    It is not recoverable afterwards — only its digest is stored.
    """
    token = generate_session_token()
    now = datetime.now(UTC)
    settings = get_settings()

    session = UserSession(
        user_id=user.id,
        token_hash=hash_session_token(token),
        expires_at=now + timedelta(seconds=settings.session_ttl_seconds),
        last_used_at=now,
        user_agent_summary=user_agent_summary,
    )
    db.add(session)
    await db.flush()
    return session, token


async def resolve_session(db: AsyncSession, token: str) -> UserSession | None:
    """Look up a live session by its token, with ``session.user`` loaded.

    Returns ``None`` for every failure mode — unknown, expired, or belonging to
    a deactivated account — so callers cannot accidentally distinguish them.
    """
    result = await db.execute(
        select(UserSession)
        .where(UserSession.token_hash == hash_session_token(token))
        .options(joinedload(UserSession.user))
    )
    session = result.unique().scalar_one_or_none()
    if session is None:
        return None

    now = datetime.now(UTC)
    if session.expires_at <= now:
        await db.delete(session)
        await db.commit()
        return None

    if session.user is None or not session.user.is_active:
        return None

    await _touch(db, session, now)
    return session


async def _touch(db: AsyncSession, session: UserSession, now: datetime) -> None:
    interval = get_settings().session_touch_interval_seconds
    if (now - session.last_used_at).total_seconds() < interval:
        return
    session.last_used_at = now
    await db.commit()


async def revoke_session_by_token(db: AsyncSession, token: str) -> None:
    """Delete a session outright rather than tombstoning it.

    A revoked session has no further use, and keeping its digest around would
    only extend how long a stale credential is worth attacking.
    """
    await db.execute(delete(UserSession).where(UserSession.token_hash == hash_session_token(token)))
    await db.flush()


async def revoke_all_sessions_for_user(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(delete(UserSession).where(UserSession.user_id == user_id))
    await db.flush()
