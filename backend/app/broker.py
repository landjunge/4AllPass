"""Loopback access relay for the local profile.

Same contract as ``scripts/local-access-broker.mjs``. This process never
decrypts envelopes and never invents tokens. Policy and plaintext stay in
the unlocked UI. Pairing token is not a vault key.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

POLL_SECONDS = 25
ACCESS_WAIT_SECONDS = 60
MAX_BODY = 64 * 1024

log = logging.getLogger("fourallpass.broker")

router = APIRouter(tags=["access-broker"])


def browser_grant_origin(origin: str | None) -> bool:
    if not origin:
        return False
    lower = origin.lower()
    if lower == "null":
        return True
    return lower.startswith("http://") or lower.startswith("https://")


def origin_allowed(origin: str | None, allowlist: list[str]) -> bool:
    if not origin:
        return False
    extras = []
    for item in allowlist:
        extras.append(item)
        extras.append(item.replace("localhost", "127.0.0.1"))
        extras.append(item.replace("127.0.0.1", "localhost"))
    return origin in extras


class BrokerHub:
    def __init__(self, token: str, origins: list[str]) -> None:
        self.token = token
        self.origins = origins
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.waiting: dict[str, asyncio.Future] = {}
        self.pollers = 0

    def _authorized(self, request: Request) -> bool:
        header = request.headers.get("authorization") or ""
        if not header.lower().startswith("bearer "):
            return False
        got = header.split(" ", 1)[1].strip()
        if not got or not self.token:
            return False
        return secrets.compare_digest(got, self.token)

    def _has_listener(self) -> bool:
        return self.pollers > 0 or not self.queue.empty() or bool(self.waiting)


def denied(reason: str, status_code: int = 200) -> JSONResponse:
    return JSONResponse(
        {"status": "denied", "reason": reason},
        status_code=status_code,
        headers={"cache-control": "no-store"},
    )


def _hub(request: Request) -> BrokerHub | None:
    return getattr(request.app.state, "broker", None)


@router.get("/v1/broker/poll")
async def broker_poll(request: Request) -> Response:
    hub = _hub(request)
    if hub is None:
        return denied("malformed_request", 404)
    origin = request.headers.get("origin")
    # Same-origin fetch from the local UI often omits Origin. Cross-site still
    # needs an allowlisted Origin. Pairing token is required either way.
    if origin and not origin_allowed(origin, hub.origins):
        return Response(status_code=403)
    if not hub._authorized(request):
        return denied("malformed_request", 401)
    hub.pollers += 1
    try:
        job = await asyncio.wait_for(hub.queue.get(), timeout=POLL_SECONDS)
    except asyncio.TimeoutError:
        return Response(status_code=204, headers={"cache-control": "no-store"})
    finally:
        hub.pollers -= 1
    return JSONResponse(job, headers={"cache-control": "no-store"})


@router.post("/v1/broker/decide")
async def broker_decide(request: Request) -> Response:
    hub = _hub(request)
    if hub is None:
        return denied("malformed_request", 404)
    origin = request.headers.get("origin")
    if origin and not origin_allowed(origin, hub.origins):
        return Response(status_code=403)
    if not hub._authorized(request):
        return denied("malformed_request", 401)
    try:
        payload = await request.json()
    except Exception:
        return denied("malformed_request", 400)
    req_id = payload.get("id") if isinstance(payload, dict) else None
    body = payload.get("body") if isinstance(payload, dict) else None
    if not isinstance(req_id, str):
        return denied("malformed_request", 400)
    fut = hub.waiting.get(req_id)
    if fut is None or fut.done():
        return denied("malformed_request", 404)
    status = body.get("status") if isinstance(body, dict) else None
    log.info("decide %s", status if isinstance(status, str) else "unknown")
    if not isinstance(body, dict):
        body = {"status": "denied", "reason": "malformed_request"}
    fut.set_result(body)
    return JSONResponse({"ok": True}, headers={"cache-control": "no-store"})


@router.post("/v1/access/request")
async def access_request(request: Request) -> Response:
    """Relay only. The secret, if any, is supplied later by the unlocked UI."""
    hub = _hub(request)
    if hub is None:
        return denied("malformed_request", 404)
    origin = request.headers.get("origin")
    if browser_grant_origin(origin):
        log.warning("rejected browser Origin on grant path")
        return denied("malformed_request", 403)
    if not hub._authorized(request):
        return denied("malformed_request", 401)
    try:
        raw = await request.body()
    except Exception:
        return denied("malformed_request")
    if len(raw) > MAX_BODY:
        return denied("malformed_request")
    try:
        body = await request.json() if raw else {}
    except Exception:
        return denied("malformed_request")
    if not hub._has_listener():
        return denied("vault_locked")
    req_id = f"req_{secrets.token_hex(8)}"
    loop = asyncio.get_running_loop()
    fut: asyncio.Future = loop.create_future()
    hub.waiting[req_id] = fut
    await hub.queue.put(
        {"v": 1, "id": req_id, "method": "POST /v1/access/request", "body": body}
    )
    try:
        result = await asyncio.wait_for(fut, timeout=ACCESS_WAIT_SECONDS)
    except asyncio.TimeoutError:
        return denied("broker_timeout")
    finally:
        hub.waiting.pop(req_id, None)
    return JSONResponse(result, headers={"cache-control": "no-store"})
