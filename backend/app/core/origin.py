"""Same-origin enforcement for state-changing requests.

Choosing a cookie for the session (docs/backend-security-boundary.md §2) buys
``HttpOnly`` and costs a CSRF surface: the browser attaches the cookie to
cross-site requests too. ``SameSite=Lax`` already blocks the common cases, but
it is a per-browser policy and it does not cover a same-site attacker on a
sibling subdomain, so the server checks for itself.

The check is the OWASP origin-verification pattern:

* Safe methods (``GET``/``HEAD``/``OPTIONS``/``TRACE``) are exempt — they must
  not change state, and exempting ``OPTIONS`` keeps CORS preflight working.
* A request with no ``Origin`` and no ``Referer`` is allowed. Browsers send
  ``Origin`` on every cross-origin request and on same-origin state changes;
  absence means a non-browser client (``curl``, a CLI, a test), which is not
  a CSRF vector because there is no ambient cookie to ride on.
* Otherwise the origin must be the deployment's own origin or an explicitly
  configured one.

Origins are compared by host and port, not by scheme, because a TLS-
terminating reverse proxy in front of a self-hosted deployment routinely
forwards ``http`` while the browser reports ``https``. The comparison is still
sound: an attacker page can choose the ``Origin`` header's value only by
actually being served from that origin, and it can never choose the victim's
``Host`` header.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import get_settings

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})

CROSS_ORIGIN_DETAIL = "cross-origin request rejected"


def _netloc(url: str) -> str | None:
    parts = urlsplit(url)
    if not parts.netloc:
        return None
    return parts.netloc.lower()


def is_allowed_origin(origin: str, host_header: str | None, allowed_origins: list[str]) -> bool:
    candidate = _netloc(origin)
    if candidate is None:
        # "null" (sandboxed iframe, file://, some redirects) and anything else
        # unparseable is never the deployment's own origin.
        return False

    if host_header and candidate == host_header.strip().lower():
        return True

    return any(candidate == _netloc(allowed) for allowed in allowed_origins)


class SameOriginMiddleware:
    """Reject state-changing requests that a browser reports as cross-origin."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in SAFE_METHODS:
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        claimed_origin = headers.get("origin") or headers.get("referer")
        if claimed_origin is not None:
            settings = get_settings()
            if not is_allowed_origin(claimed_origin, headers.get("host"), settings.cors_origins):
                response = JSONResponse(status_code=403, content={"detail": CROSS_ORIGIN_DETAIL})
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)
