"""V07/V09 synthetic tests; no personal vault, real provider or paid call."""

import base64
import json
import time
from dataclasses import replace
import pytest
from protected_executor.core import (
    Binding,
    UseRequest,
    Grant,
    ExecutorCore,
    ProviderReply,
    Rejected,
    project_reply,
)
from protected_executor.capability import SyntheticHostCapability, SYNTHETIC_SECRET

SECRET = SYNTHETIC_SECRET


def request():
    req = UseRequest(
        Binding("p", "w", "t", "codex", "lane", "a", ""),
        "grant-1",
        origin_ref="synthetic-origin",
        principal_ref="synthetic-principal",
        grant_version=1,
    )
    return replace(req, binding=replace(req.binding, request_hash=req.content_hash()))


def grant():
    req = request()
    return Grant(
        "grant-1",
        "p",
        "w",
        "t",
        "codex",
        "lane",
        "a",
        req.origin_ref,
        req.principal_ref,
        req.binding.request_hash,
        1,
        "demo-quota-v1",
        "demo.quota.read",
        time.time() - 1,
        time.time() + 60,
        "active",
        "synthetic-consent",
    )


class LocalDummyGate:
    def dispatch(self, request, send):
        send()
        return {"state": "OUTCOME_UNKNOWN"}


def test_positive_contract_and_no_secret_output():
    seen = []

    def send(secret):
        assert secret == SECRET
        seen.append(True)
        return ProviderReply(200, b'{"remaining":7,"window":"day"}')

    saved = grant()
    result = ExecutorCore(
        transport=send,
        gate=LocalDummyGate(),
        host=SyntheticHostCapability.for_test(saved),
    ).execute(request())
    assert result["result"] == {"remaining": 7, "window": "day"}
    assert result["project_completion_verified"] is False
    assert SECRET not in json.dumps(result)
    assert SECRET not in repr(grant())
    assert seen == [True]


@pytest.mark.parametrize(
    "body",
    [
        json.dumps({"remaining": 7, "window": "day", "echo": SECRET}).encode(),
        json.dumps(
            {"remaining": 7, "window": base64.b64encode(SECRET.encode()).decode()}
        ).encode(),
        json.dumps({"remaining": True, "window": "day"}).encode(),
        b'{"remaining":7,"remaining":9,"window":"day"}',
        b'{"remaining":100001,"window":"day"}',
        b"x" * 4097,
    ],
)
def test_echo_encoded_export_and_unbounded_bodies_rejected(body):
    with pytest.raises(Rejected, match="response_rejected"):
        project_reply(ProviderReply(200, body))


@pytest.mark.parametrize(
    "reply", [ProviderReply(302, b"{}"), ProviderReply(200, b"{}", True)]
)
def test_redirects_refused(reply):
    with pytest.raises(Rejected):
        project_reply(reply)


def test_missing_gate_never_reads_material_or_sends():
    def forbidden(*_):
        raise AssertionError("must not run")

    with pytest.raises(Rejected, match="gate_unavailable"):
        ExecutorCore(
            transport=forbidden, host=SyntheticHostCapability.for_test(grant())
        ).execute(request())


@pytest.mark.parametrize(
    "changes",
    [
        {"actor_id": "other"},
        {"project_id": "other"},
        {"task_id": "other"},
        {"workflow_id": "other"},
        {"lifecycle": "revoked"},
        {"expires_at": 0},
    ],
)
def test_grant_binding_and_expiry(changes):
    calls = []
    with pytest.raises(Rejected):
        ExecutorCore(
            transport=lambda _: calls.append(1),
            gate=LocalDummyGate(),
            host=SyntheticHostCapability.for_test(replace(grant(), **changes)),
        ).execute(request())
    assert not calls


def test_target_hash_raw_export_and_transport_exception_are_not_a_fallback():
    for req in [
        replace(request(), target_id="https://evil.example"),
        replace(request(), operation="raw_secret"),
        replace(request(), grant_ref="other"),
    ]:
        with pytest.raises(Rejected):
            ExecutorCore(
                transport=lambda _: None,
                gate=LocalDummyGate(),
                host=SyntheticHostCapability.for_test(grant()),
            ).execute(req)

    def leaking(_):
        raise RuntimeError(SECRET)

    with pytest.raises(Rejected) as error:
        ExecutorCore(
            transport=leaking,
            gate=LocalDummyGate(),
            host=SyntheticHostCapability.for_test(grant()),
        ).execute(request())
    assert SECRET not in str(error.value)
