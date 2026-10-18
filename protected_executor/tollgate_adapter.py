"""Connect to the real TollGate local trusted dispatch boundary.

No copied Allow token. Import fails closed when the compatible TollGate package
is not present. This adapter does not configure budgets or bypass admission.
"""
from __future__ import annotations
from typing import Callable
from .core import Rejected, UseRequest


class TollGateDispatch:
    def __init__(self, control):
        self._control = control

    def dispatch(self, request: UseRequest, send: Callable[[], dict]) -> dict:
        try:
            from tollgate.workflow_control import AttemptIdentity, Quote, WorkflowScope
        except ImportError:
            raise Rejected("gate_unavailable") from None
        b = request.binding
        identity = AttemptIdentity(WorkflowScope(b.project_id, b.workflow_id), b.task_id,
                                   b.actor_id, b.consumer_id, b.attempt_id, b.request_hash)
        # Synthetic fixed-price, fixed-target operation only. A paid provider
        # requires its own enforceable cost quote/adapter, not this dummy quote.
        quote = Quote("4allpass-demo-quota-v1", "dummy", "demo.quota.read",
                      "demo-quota-v1", 0, "synthetic-zero-cost-v1")
        self._control.reserve(identity, quote)
        return self._control.dispatch(identity, send)
