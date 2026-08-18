"""Session and CSRF cookie handling for browser clients.

Why cookies at all, when the API also accepts ``Authorization: Bearer``:
a token that JavaScript can read is a token that any script running on the
page can exfiltrate and keep. An ``HttpOnly`` cookie is unreadable from
JavaScript, so it survives the class of bug that ``sessionStorage`` does not.
See docs/backend-security.md §3 for the full decision.

Cookies buy that at the cost of being *ambient*: the browser attaches them to
cross-site requests too, which is CSRF. Two mechanisms answer that, and both
are here on purpose rather than one of them:

* ``SameSite`` (default ``strict``) stops the browser sending the session
  cookie on cross-site requests at all. It is the primary defence, and it is
  viable because the PWA is served same-origin with the API (vite proxy in
  development, nginx in deployment).
* A CSRF token bound to the session, checked on unsafe methods. This is the
  backstop for the cases SameSite does not cover on its own — a
  misconfigured permissive CORS origin, or a same-site subdomain that an
  attacker controls.

The CSRF cookie is intentionally **not** ``HttpOnly``: the page has to read it
to echo it back in ``X-CSRF-Token``. That is safe because it is not a
credential on its own — the server only accepts it together with the session
cookie, and it is compared against the value bound to *that* session.
"""

from __future__ import annotations

from fastapi import Response

from app.core.config import Settings, get_settings

CSRF_HEADER_NAME = "X-CSRF-Token"


def set_session_cookies(response: Response, *, session_token: str, csrf_token: str) -> None:
    settings = get_settings()
    _set(response, settings, settings.session_cookie_name, session_token, http_only=True)
    _set(response, settings, settings.csrf_cookie_name, csrf_token, http_only=False)


def clear_session_cookies(response: Response) -> None:
    settings = get_settings()
    for name in (settings.session_cookie_name, settings.csrf_cookie_name):
        response.delete_cookie(
            key=name,
            path=settings.session_cookie_path,
            domain=settings.session_cookie_domain,
            secure=settings.cookies_require_secure,
            httponly=name == settings.session_cookie_name,
            samesite=settings.session_cookie_samesite,
        )


def _set(response: Response, settings: Settings, name: str, value: str, *, http_only: bool) -> None:
    response.set_cookie(
        key=name,
        value=value,
        max_age=settings.session_ttl_seconds,
        path=settings.session_cookie_path,
        domain=settings.session_cookie_domain,
        secure=settings.cookies_require_secure,
        httponly=http_only,
        samesite=settings.session_cookie_samesite,
    )
