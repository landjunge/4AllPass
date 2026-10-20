"""Streamed request bodies must hit the same ceiling as Content-Length."""

from __future__ import annotations

import asyncio

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
async def test_after_replayed_body_transport_disconnect_is_preserved():
    async def twice(scope, receive, send):
        first = await receive()
        second = await receive()
        assert first["type"] == "http.request"
        assert second["type"] == "http.disconnect"
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": first.get("body") or b""})

    app = BodyLimitMiddleware(twice, max_bytes=32)
    sent = await _call(app, _scope(), [b"grant"])
    assert sent[0]["status"] == 200
    assert sent[1]["body"] == b"grant"


@pytest.mark.asyncio
async def test_over_limit_chunk_rejected_without_waiting_for_a_stalled_remainder():
    reads = 0
    application_called = False
    never = asyncio.Event()
    sent = []

    async def receive():
        nonlocal reads
        reads += 1
        if reads == 1:
            return {"type": "http.request", "body": b"12345", "more_body": True}
        await never.wait()
        raise AssertionError("A stalled body must not be consumed after rejection")

    async def application(scope, receive, send):
        nonlocal application_called
        application_called = True

    async def send(message):
        sent.append(message)

    await asyncio.wait_for(
        BodyLimitMiddleware(application, max_bytes=4)(_scope(), receive, send), timeout=0.5
    )
    assert reads == 1 and not application_called
    assert [message["type"] for message in sent] == [
        "http.response.start", "http.response.body"
    ]
    assert sent[0]["status"] == 413
    assert sent[1]["body"] == b'{"detail":"payload too large"}'


@pytest.mark.asyncio
async def test_valid_multichunk_body_at_exact_limit_is_preserved():
    sent = await _call(BodyLimitMiddleware(_echo, max_bytes=4), _scope(), [b"ab", b"cd"])
    assert sent[0]["status"] == 200 and sent[1]["body"] == b"abcd"


@pytest.mark.asyncio
async def test_disconnect_during_incomplete_acceptable_body_does_not_run_application():
    messages = iter([
        {"type": "http.request", "body": b"a", "more_body": True},
        {"type": "http.disconnect"},
    ])

    async def receive():
        return next(messages)

    async def unexpected(*args):
        raise AssertionError("Disconnected incomplete requests must not reach the application")

    await BodyLimitMiddleware(unexpected, max_bytes=4)(_scope(), receive, unexpected)


@pytest.mark.asyncio
@pytest.mark.parametrize("version", ["1.0", "1.1", "2"])
async def test_http1_rejection_closes_connection_without_hop_by_hop_header_on_http2(version):
    scope = {**_scope(content_length="99"), "http_version": version}
    sent = []

    async def unexpected(*args):
        raise AssertionError("A declared oversized body needs neither body nor application")

    async def send(message):
        sent.append(message)

    await BodyLimitMiddleware(unexpected, max_bytes=4)(scope, unexpected, send)
    assert sent[0]["status"] == 413
    assert ((b"connection", b"close") in sent[0]["headers"]) == (version != "2")


@pytest.mark.asyncio
async def test_real_http1_incomplete_chunked_upload_receives_413_and_eof():
    import socket

    import uvicorn

    application_called = False

    async def application(scope, receive, send):
        nonlocal application_called
        application_called = True
        await _echo(scope, receive, send)

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(
        BodyLimitMiddleware(application, max_bytes=4), lifespan="off", loop="asyncio",
        http="h11", ws="none", access_log=False, log_level="critical",
    ))
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    writer = None
    try:
        async with asyncio.timeout(3):
            while not server.started:
                if serving.done():
                    await serving
                    raise AssertionError("The isolated server did not start")
                await asyncio.sleep(0.01)
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        writer.write((
            f"POST / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
            "Transfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n"
            "5\r\n12345\r\n"
        ).encode())
        await writer.drain()
        # Deliberately no final chunk and no client disconnect: wait for the server.
        response = await asyncio.wait_for(reader.read(), timeout=2)
        assert response.startswith(b"HTTP/1.1 413 ")
        assert b"connection: close\r\n" in response.lower()
        assert b'{"detail":"payload too large"}' in response
        assert not application_called
    finally:
        if writer is not None:
            writer.close()
            await writer.wait_closed()
        server.should_exit = True
        await asyncio.wait_for(serving, timeout=5)
        listener.close()
