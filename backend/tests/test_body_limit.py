"""Streamed request bodies must hit the same ceiling as Content-Length."""

from __future__ import annotations

import pytest

from app.body_limit import BodyLimitMiddleware


async def _echo(scope, receive, send):
    message = await receive()
    body = message.get("body") or b""
    await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/plain")]})
    await send({"type": "http.response.body", "body": body})


def _scope(*, content_length: str | None = None) -> dict:
    headers = []
    if content_length is not None:
        headers.append((b"content-length", content_length.encode()))
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 1),
        "server": ("127.0.0.1", 80),
    }


async def _call(app, scope, chunks: list[bytes]) -> list[dict]:
    queue = [{"type": "http.request", "body": chunk, "more_body": i < len(chunks) - 1} for i, chunk in enumerate(chunks)]
    if not queue:
        queue = [{"type": "http.request", "body": b"", "more_body": False}]

    async def receive():
        return queue.pop(0) if queue else {"type": "http.disconnect"}

    sent: list[dict] = []

    async def send(message):
        sent.append(message)

    await app(scope, receive, send)
    return sent


@pytest.mark.asyncio
async def test_streamed_body_without_content_length_is_capped():
    app = BodyLimitMiddleware(_echo, max_bytes=4)
    sent = await _call(app, _scope(), [b"abc", b"de"])
    assert sent[0]["status"] == 413


@pytest.mark.asyncio
async def test_content_length_over_limit_is_413_before_read():
    app = BodyLimitMiddleware(_echo, max_bytes=4)
    sent = await _call(app, _scope(content_length="99"), [b"x"])
    assert sent[0]["status"] == 413


@pytest.mark.asyncio
async def test_body_within_limit_is_passed_through():
    app = BodyLimitMiddleware(_echo, max_bytes=8)
    sent = await _call(app, _scope(), [b"ok"])
    assert sent[0]["status"] == 200
    assert sent[1]["body"] == b"ok"


@pytest.mark.asyncio
async def test_inner_app_may_call_receive_twice_without_204():
    async def twice(scope, receive, send):
        first = await receive()
        second = await receive()
        assert first["type"] == "http.request"
        assert second["type"] == "http.request"
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": first.get("body") or b""})

    app = BodyLimitMiddleware(twice, max_bytes=32)
    sent = await _call(app, _scope(), [b"grant"])
    assert sent[0]["status"] == 200
    assert sent[1]["body"] == b"grant"
