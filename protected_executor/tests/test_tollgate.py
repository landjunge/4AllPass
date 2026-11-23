"""Run with the matching actual TollGate source on PYTHONPATH, never a fake Allow."""

import json
from dataclasses import replace
import pytest
from protected_executor.core import ExecutorCore, ProviderReply, Rejected
from protected_executor.tollgate_adapter import TollGateDispatch
from protected_executor.capability import SyntheticHostCapability
from protected_executor.tests.test_core import request, grant, SECRET

control_module = pytest.importorskip("tollgate.workflow_control")


def configured(root):
    m = control_module
    quote = m.Quote(
        "4allpass-demo-quota-v1",
        "dummy",
        "demo.quota.read",
        "demo-quota-v1",
        0,
        "synthetic-zero-cost-v1",
    )
    control = m.WorkflowControl(
        root=root,
        registered_quotes={quote.adapter_id: quote},
        admission=lambda *_: True,
    )
    control.configure_budget(m.WorkflowScope("p", "w"), "codex", "lane", 0)
    return control


def test_actual_gate_restart_idempotency_and_stop(tmp_path):
    m = control_module
    control = configured(tmp_path)
    saved = grant()
    sent = []

    def transport(secret):
        assert secret == SECRET
        sent.append(1)
        return ProviderReply(200, b'{"remaining":4,"window":"month"}')

    core = ExecutorCore(
        transport=transport,
        gate=TollGateDispatch(control),
        host=SyntheticHostCapability.for_test(saved),
    )
    assert core.execute(request())["result"] == {"remaining": 4, "window": "month"}
    # Same persisted attempt after process-level reconstruction never sends twice.
    restarted = ExecutorCore(
        transport=transport,
        gate=TollGateDispatch(configured(tmp_path)),
        host=SyntheticHostCapability.for_test(saved),
    )
    assert restarted.execute(request())["status"] == "unverified"
    assert sent == [1]
    stopped = control.stop(m.WorkflowScope("p", "w"), "stop-test")
    assert stopped["further_dispatch_blocked"] is True
    req = replace(request(), binding=replace(request().binding, attempt_id="b"))
    req = replace(req, binding=replace(req.binding, request_hash=req.content_hash()))
    from dataclasses import replace as update

    new_grant = update(
        saved, attempt_id=req.binding.attempt_id, request_hash=req.binding.request_hash
    )
    stopped_core = ExecutorCore(
        transport=transport,
        gate=TollGateDispatch(configured(tmp_path)),
        host=SyntheticHostCapability.for_test(new_grant),
    )
    assert stopped_core.execute(req)["status"] == "unverified"
    assert sent == [1]
    for path in tmp_path.rglob("*.json*"):
        assert SECRET not in path.read_text()


def test_actual_gate_retains_unknown_without_transport_error_leak(tmp_path):
    control = configured(tmp_path)
    saved = grant()
    sent = []

    def transport(_):
        sent.append(1)
        raise TimeoutError(SECRET)

    core = ExecutorCore(
        transport=transport,
        gate=TollGateDispatch(control),
        host=SyntheticHostCapability.for_test(saved),
    )
    result = core.execute(request())
    assert result["status"] == "unverified"
    assert SECRET not in json.dumps(result)
    assert core.execute(request())["status"] == "unverified"
    assert sent == [1]


def test_cap1_replay_does_not_dispatch_or_modify_actual_gate_journal(tmp_path):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from protected_executor.tests.test_cap1 import TestNonceStore, evidence, execution, verifier

    key = Ed25519PrivateKey.generate()
    store = TestNonceStore(tmp_path / "cap1-nonces.sqlite3")
    gate_root = tmp_path / "gate"
    gate = TollGateDispatch(configured(gate_root))
    use = request()
    proof = evidence(key, use)
    executor, effects = execution(verifier(key.public_key(), store.consume), gate=gate)
    assert executor.execute(use, proof=proof)["result"]["remaining"] == 7
    assert effects == ["dispatch", "send"]
    journal = {path: path.read_bytes() for path in gate_root.rglob("*") if path.is_file()}
    assert journal

    with pytest.raises(Rejected, match="^capability_nonce_used$"):
        executor.execute(use, proof=proof)
    assert {path: path.read_bytes() for path in gate_root.rglob("*") if path.is_file()} == journal
    assert effects == ["dispatch", "send"]
    for value in (proof.claims.nonce, proof.signature.hex()):
        assert all(value.encode() not in recorded for recorded in journal.values())


def test_real_loopback_dummy_api_through_actual_gate(tmp_path, capsys):
    """Real bounded GET to an isolated dummy listener; never a real credential."""
    import http.client
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    seen = []

    class Dummy(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            assert self.path == "/quota"
            assert self.headers.get("Authorization") == "Bearer " + SECRET
            seen.append("authorized_dummy_get")
            body = b'{"remaining":3,"window":"day"}'
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Dummy)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()

    def transport(secret):
        # Host chooses the target, method and path; request has none of them.
        conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=2)
        try:
            conn.request("GET", "/quota", headers={"Authorization": "Bearer " + secret})
            reply = conn.getresponse()
            return ProviderReply(reply.status, reply.read(4097))
        finally:
            conn.close()

    saved = grant()
    try:
        result = ExecutorCore(
            transport=transport,
            gate=TollGateDispatch(configured(tmp_path)),
            host=SyntheticHostCapability.for_test(saved),
        ).execute(request())
        assert result["result"] == {"remaining": 3, "window": "day"}
        assert seen == ["authorized_dummy_get"]
        assert SECRET not in json.dumps(result)
        captured = capsys.readouterr()
        assert SECRET not in captured.out + captured.err
    finally:
        server.shutdown()
        server.server_close()
        worker.join(3)
