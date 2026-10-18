"""Fixed, bounded quota-read operation. Not a generic credential proxy."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol

from .capability import require_synthetic_host
from .contracts import (
    Binding,
    Grant,
    ProtectedGrant,
    Rejected,
    UseRequest,
    validate_grant,
    validate_request,
)

__all__ = [
    "Binding",
    "ExecutorCore",
    "Grant",
    "ProtectedGrant",
    "ProviderReply",
    "Rejected",
    "UseRequest",
    "project_reply",
]


@dataclass(frozen=True)
class ProviderReply:
    status: int
    body: bytes = field(repr=False)
    redirected: bool = False


class Gate(Protocol):
    def dispatch(self, request: UseRequest, send: Callable[[], dict]) -> object: ...


class ExecutorCore:
    """Host-side core with NO default gate, transport, URL, file store or server.

    Only an explicit fixed-secret SyntheticHostCapability can run dummy tests.
    No production host capability exists; DTOs/booleans/legacy callbacks fail closed.
    The operation has one operator-owned target and no caller URL, method,
    headers, payload or response-field selector. The host must prove process/
    filesystem/debug isolation before connecting real material. Dummy tests
    do not meet that production prerequisite.
    """

    def __init__(
        self,
        grant_lookup: Callable[[str], Grant] | None = None,
        transport: Callable[[str], ProviderReply] | None = None,
        gate: Gate | None = None,
        *,
        host: object = None,
    ):
        # Legacy material callbacks cannot become a trusted host. No production
        # capability is supported; only an explicit fixed-secret test fixture.
        self._legacy_lookup = grant_lookup is not None
        self._transport, self._gate, self._host = transport, gate, host

    def execute(self, request: UseRequest) -> dict:
        host = require_synthetic_host(self._host)
        if self._legacy_lookup:
            raise Rejected("protected_host_unavailable")
        if self._gate is None:
            raise Rejected("gate_unavailable")
        if self._transport is None:
            raise Rejected("transport_unavailable")
        validate_request(request)
        grant = host._lookup(request.grant_ref)
        validate_grant(request, grant, time.time())
        result: dict = {}
        callback_attempted = False

        def send() -> dict:
            nonlocal callback_attempted
            if callback_attempted:
                raise Rejected("duplicate_dispatch_callback")
            callback_attempted = True
            # Recheck expiry/revocation at actual dispatch, after gate ordering.
            current = host._lookup(request.grant_ref)
            validate_grant(request, current, time.time())
            if current != grant:
                raise Rejected("grant_unavailable")
            try:
                reply = self._transport(host._synthetic_material(current))
                projected = project_reply(reply)
            except Exception:  # noqa: BLE001 - sanitize arbitrary trusted-adapter errors
                # Do not expose exceptions (which may contain headers/body/URL).
                raise Rejected("provider_outcome_unverified") from None
            result.update(projected)
            return {"operation": "demo.quota.read", "response_validated": True}

        try:
            self._gate.dispatch(request, send)
        except Exception:  # noqa: BLE001 - sanitize arbitrary trusted-adapter errors
            raise Rejected("dispatch_outcome_unverified") from None
        if not result:
            # A replay reads the gate state; it never triggers another send and
            # cannot recreate data kept only in the previous process's memory.
            return {
                "status": "unverified",
                "outcome": "read_existing_gate_record",
                "execution_scope": "synthetic_test_only",
                "production_host_available": False,
                "project_completion_verified": False,
            }
        return {
            "status": "delivered_unverified",
            "result": result,
            "cost_settled": False,
            "execution_scope": "synthetic_test_only",
            "production_host_available": False,
            "project_completion_verified": False,
        }


def project_reply(reply: ProviderReply) -> dict:
    if reply.status != 200 or reply.redirected or len(reply.body) > 4096:
        raise Rejected("response_rejected")

    def unique(pairs):
        obj = {}
        for key, value in pairs:
            if key in obj:
                raise ValueError("duplicate_field")
            obj[key] = value
        return obj

    try:
        body = json.loads(reply.body, object_pairs_hook=unique)
        if not isinstance(body, dict) or set(body) != {"remaining", "window"}:
            raise ValueError("shape")
        if type(body["remaining"]) is not int or not 0 <= body["remaining"] <= 100_000:
            raise ValueError("count")
        if body["window"] not in ("day", "month"):
            raise ValueError("window")
    except Exception:  # noqa: BLE001 - sanitize arbitrary trusted-adapter errors
        raise Rejected("response_rejected") from None
    return {"remaining": body["remaining"], "window": body["window"]}
