"""V07/V09 synthetic tests; no personal vault, real provider or paid call."""
import base64
import json
import time
from dataclasses import replace
import pytest
from protected_executor.core import Binding, UseRequest, Grant, ExecutorCore, ProviderReply, Rejected, project_reply

SECRET = "synthetic-only-not-a-real-key"


def request():
    req = UseRequest(Binding("p", "w", "t", "codex", "lane", "a", ""), "grant-1")
    return replace(req, binding=replace(req.binding, request_hash=req.content_hash()))


def grant():
    return Grant("grant-1", "p", "w", "t", "codex", "demo-quota-v1", time.time()+60, SECRET)


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
    result = ExecutorCore(lambda _: saved, send, LocalDummyGate()).execute(request())
    assert result["result"] == {"remaining": 7, "window": "day"}
    assert result["project_completion_verified"] is False
    assert SECRET not in json.dumps(result)
    assert SECRET not in repr(grant())
    assert seen == [True]


@pytest.mark.parametrize("body", [
    json.dumps({"remaining":7,"window":"day","echo":SECRET}).encode(),
    json.dumps({"remaining":7,"window":base64.b64encode(SECRET.encode()).decode()}).encode(),
    json.dumps({"remaining":True,"window":"day"}).encode(),
    b'{"remaining":7,"remaining":9,"window":"day"}',
    b'{"remaining":100001,"window":"day"}',
    b'x'*4097,
])
def test_echo_encoded_export_and_unbounded_bodies_rejected(body):
    with pytest.raises(Rejected, match="response_rejected"):
        project_reply(ProviderReply(200, body))


@pytest.mark.parametrize("reply", [ProviderReply(302,b'{}'),ProviderReply(200,b'{}',True)])
def test_redirects_refused(reply):
    with pytest.raises(Rejected): project_reply(reply)


def test_missing_gate_never_reads_material_or_sends():
    def forbidden(*_): raise AssertionError("must not run")
    with pytest.raises(Rejected, match="gate_unavailable"):
        ExecutorCore(forbidden, forbidden).execute(request())


@pytest.mark.parametrize("changes", [{"actor_id":"other"},{"project_id":"other"},{"task_id":"other"},{"workflow_id":"other"},{"revoked":True},{"expires_at":0}])
def test_grant_binding_and_expiry(changes):
    calls=[]
    with pytest.raises(Rejected):
        ExecutorCore(lambda _: replace(grant(),**changes),lambda _:calls.append(1),LocalDummyGate()).execute(request())
    assert not calls


def test_target_hash_raw_export_and_transport_exception_are_not_a_fallback():
    for req in [replace(request(), target_id="https://evil.example"), replace(request(), operation="raw_secret"), replace(request(), grant_ref="other")]:
        with pytest.raises(Rejected): ExecutorCore(lambda _:grant(),lambda _:None,LocalDummyGate()).execute(req)
    def leaking(_): raise RuntimeError(SECRET)
    with pytest.raises(Rejected) as error:
        ExecutorCore(lambda _:grant(),leaking,LocalDummyGate()).execute(request())
    assert SECRET not in str(error.value)
