"""Count request body bytes, including chunked ASGI frames without Content-Length."""

from __future__ import annotations

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.limits import REQUEST_BODY_MAX

_TOO_LARGE = b'{"detail":"payload too large"}'


async def _reject(send: Send) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [(b"content-type", b"application/json")],
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
                    await _reject(send)
                    return
            except ValueError:
                await _reject(send)
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
                while message.get("more_body"):
                    message = await receive()
                    if message.get("type") != "http.request":
                        break
                await _reject(send)
                return
            chunks.append(body)
            more = bool(message.get("more_body"))

        replayed = False

        async def replay_receive() -> dict:
            nonlocal replayed
            if replayed:
                return {"type": "http.disconnect"}
            replayed = True
            return {"type": "http.request", "body": b"".join(chunks), "more_body": False}

        await self.app(scope, replay_receive, send)
