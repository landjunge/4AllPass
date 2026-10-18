"""Fixed, bounded quota-read operation. Not a generic credential proxy."""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Callable, Protocol


class Rejected(Exception):
    """Only stable codes escape; never include transport exceptions or bodies."""


@dataclass(frozen=True)
class Binding:
    project_id: str
    workflow_id: str
    task_id: str
    actor_id: str
    consumer_id: str
    attempt_id: str
    request_hash: str


@dataclass(frozen=True)
class UseRequest:
    binding: Binding
    grant_ref: str
    operation: str = "demo.quota.read"
    target_id: str = "demo-quota-v1"

    def content_hash(self) -> str:
        # This exact shape is what the caller must bind as G-01 content hash.
        fields = {"grant_ref": self.grant_ref, "operation": self.operation,
                  "target_id": self.target_id, "project_id": self.binding.project_id,
                  "workflow_id": self.binding.workflow_id, "task_id": self.binding.task_id,
                  "actor_id": self.binding.actor_id, "consumer_id": self.binding.consumer_id,
                  "attempt_id": self.binding.attempt_id}
        return hashlib.sha256(json.dumps(fields, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@dataclass(frozen=True)
class Grant:
    reference: str
    project_id: str
    workflow_id: str
    task_id: str
    actor_id: str
    target_id: str
    expires_at: float
    # Granted material is provided only by the private trusted host, never from
    # an agent request or a generic tool return. No key in repr/diagnostic output.
    secret: str = field(repr=False)
    operation: str = "demo.quota.read"
    revoked: bool = False


@dataclass(frozen=True)
class ProviderReply:
    status: int
    body: bytes = field(repr=False)
    redirected: bool = False


class Gate(Protocol):
    def dispatch(self, request: UseRequest, send: Callable[[], dict]) -> object: ...


class ExecutorCore:
    """Host-side core with NO default gate, transport, URL, file store or server.

    The operation has one operator-owned target and no caller URL, method,
    headers, payload or response-field selector. The host must prove process/
    filesystem/debug isolation before connecting real material. Dummy tests
    do not meet that production prerequisite.
    """
    def __init__(self, grant_lookup: Callable[[str], Grant],
                 transport: Callable[[str], ProviderReply], gate: Gate | None = None):
        self._lookup, self._transport, self._gate = grant_lookup, transport, gate

    def execute(self, request: UseRequest) -> dict:
        if self._gate is None:
            raise Rejected("gate_unavailable")
        if request.operation != "demo.quota.read" or request.target_id != "demo-quota-v1":
            raise Rejected("unsupported_operation")
        if request.binding.request_hash != request.content_hash():
            raise Rejected("content_conflict")
        try:
            grant = self._lookup(request.grant_ref)
        except Exception:
            raise Rejected("grant_unavailable") from None
        for name in ("project_id", "workflow_id", "task_id", "actor_id"):
            if getattr(grant, name) != getattr(request.binding, name):
                raise Rejected("grant_binding_mismatch")
        if (grant.reference != request.grant_ref or grant.target_id != request.target_id
                or grant.operation != request.operation or grant.revoked
                or time.time() >= grant.expires_at):
            raise Rejected("grant_unavailable")
        result: dict = {}

        def send() -> dict:
            # Recheck expiry/revocation at actual dispatch, after gate ordering.
            current = self._lookup(request.grant_ref)
            if current != grant or current.revoked or time.time() >= current.expires_at:
                raise Rejected("grant_unavailable")
            try:
                reply = self._transport(current.secret)
                projected = project_reply(reply)
            except Exception:
                # Do not expose exceptions (which may contain headers/body/URL).
                raise Rejected("provider_outcome_unverified") from None
            result.update(projected)
            return {"operation": "demo.quota.read", "response_validated": True}

        try:
            state = self._gate.dispatch(request, send)
        except Exception:
            raise Rejected("dispatch_outcome_unverified") from None
        if not result:
            # A replay reads the gate state; it never triggers another send and
            # cannot recreate data kept only in the previous process's memory.
            return {"status": "unverified", "outcome": "read_existing_gate_record", "project_completion_verified": False}
        return {"status": "delivered_unverified", "result": result, "cost_settled": False, "project_completion_verified": False}


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
    except Exception:
        raise Rejected("response_rejected") from None
    return {"remaining": body["remaining"], "window": body["window"]}
