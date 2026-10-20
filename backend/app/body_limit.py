"""Count request body bytes, including chunked ASGI frames without Content-Length."""

from __future__ import annotations

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.limits import REQUEST_BODY_MAX

_TOO_LARGE = b'{"detail":"payload too large"}'


async def _reject(scope: Scope, send: Send) -> None:
    headers = [(b"content-type", b"application/json")]
    if scope.get("http_version", "1.1") in {"1.0", "1.1"}:
        # Let the HTTP server close an unread HTTP/1 request. Never wait for
        # its remainder here, or emit a forbidden Connection header on HTTP/2.
        headers.append((b"connection", b"close"))
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": headers,
        }
    )
    await send({"type": "http.response.body", "body": _TOO_LARGE})


class BodyLimitMiddleware:
    """Reject oversized snapshot bodies before JSON parse."""

    def __init__(self, app: ASGIApp, max_bytes: int = REQUEST_BODY_MAX) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        raw = headers.get("content-length")
        if raw:
            try:
                if int(raw) > self.max_bytes:
                    await _reject(scope, send)
                    return
            except ValueError:
                await _reject(scope, send)
                return
        received = 0
        chunks: list[bytes] = []
        more = True
        while more:
            message = await receive()
            kind = message.get("type")
            if kind == "http.disconnect":
                return
            if kind != "http.request":
                break
            body = message.get("body") or b""
            received += len(body)
            if received > self.max_bytes:
                await _reject(scope, send)
                return
            chunks.append(body)
            more = bool(message.get("more_body"))

        first = True

        async def replay_receive() -> dict:
            nonlocal first
            if first:
                first = False
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            # After replaying the bounded body, preserve the transport's actual
            # disconnect/wait semantics. Immediate synthetic request frames can
            # busy-loop and starve FileResponse's streaming task (ASGI < 2.4).
            # An invented disconnect would instead abort a live response.
            return await receive()

        await self.app(scope, replay_receive, send)
