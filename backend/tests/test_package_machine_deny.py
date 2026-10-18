"""Package-check regression probes: real broker handler, synthetic loopback only."""

from __future__ import annotations

import asyncio
import importlib.util
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from app.broker import BrokerHub, router
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def probe(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / "scripts"))
    import package_machine_deny

    return package_machine_deny


@pytest.fixture
def broker_harness(probe):
    app = FastAPI()
    app.include_router(router)
    app.state.broker = BrokerHub(probe.SYNTHETIC_BROKER_TOKEN, [])
    requests = []
    override = [None]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = self.rfile.read(
                min(int(self.headers.get("Content-Length", "0")), 512)
            )
            requests.append(self.path)
            injected = override[0](self, body) if override[0] else None
            if injected is None:

                async def call_actual_handler():
                    async with AsyncClient(
                        transport=ASGITransport(app=app), base_url="http://127.0.0.1"
                    ) as client:
                        return await client.post(
                            self.path, headers=dict(self.headers), content=body
                        )

                response = asyncio.run(call_actual_handler())
                status, content, headers = response.status_code, response.content, {}
            else:
                status, content, headers = injected
            self.send_response(status)
            self.send_header("Content-Length", str(len(content)))
            for name, value in headers.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(content)

        def do_GET(self):
            # Redirects must never reach this trap (including a changed method).
            requests.append(self.path)
            self.send_response(500)
            self.end_headers()

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True
    )
    thread.start()
    try:
        yield server.server_port, requests, override, app.state.broker
    finally:
        server.shutdown()
        server.server_close()
        thread.join(2)
        assert not thread.is_alive()


def test_real_broker_handler_all_package_denials(probe, broker_harness, monkeypatch):
    port, requests, _, hub = broker_harness
    # The package probe must stay loopback even in an inherited proxy environment.
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:1")
    monkeypatch.setenv("no_proxy", "")
    result = probe.machine_handoff_deny_probe(port)
    assert result == {
        "packaged_machine_handoff_deny_v1": True,
        "machine_handoff_deny_checks": list(probe.DENY_CASES),
    }
    assert requests == ["/v1/access/request"] * 8
    assert hub.queue.empty() and not hub.waiting
    assert probe.SYNTHETIC_BROKER_TOKEN not in json.dumps(result)


@pytest.mark.parametrize(
    "status,body",
    [
        (
            200,
            b'{"status":"approved","access_token":"synthetic-payload-must-not-leak"}',
        ),
        (
            200,
            b'{"status":"denied","reason":"handoff_unavailable","material":"synthetic"}',
        ),
        (
            200,
            b'{"status":"approved","status":"denied","reason":"handoff_unavailable"}',
        ),
        (200, b'{"status":"denied","reason":"vault_locked"}'),
        (200, b'["synthetic-payload-must-not-leak"]'),
        (200, b"x" * 513),
        (500, b"synthetic-payload-must-not-leak"),
    ],
)
def test_wrong_or_secret_shaped_responses_never_pass_or_leak(
    probe, broker_harness, status, body, capsys
):
    port, requests, override, _ = broker_harness
    override[0] = lambda _handler, _request: (status, body, {})
    with pytest.raises(RuntimeError) as failure:
        probe.machine_handoff_deny_probe(port)
    assert str(failure.value) == "packaged_machine_deny_failed:omitted_handoff"
    assert "synthetic-payload" not in repr(failure.value)
    assert capsys.readouterr() == ("", "")
    assert len(requests) == 1


@pytest.mark.parametrize("weakening", ["raw_secret", "mediated", "token", "origin"])
def test_each_security_regression_is_detected(probe, broker_harness, weakening):
    port, _, override, _ = broker_harness

    def weakened(handler, raw):
        body = json.loads(raw)
        if (
            body.get("handoff") == weakening
            or (weakening == "token" and not handler.headers.get("Authorization"))
            or (weakening == "origin" and handler.headers.get("Origin"))
        ):
            return 200, b'{"status":"denied","reason":"handoff_unavailable"}', {}
        return None

    if weakening in {"raw_secret", "mediated"}:

        def weakened(handler, raw):
            if json.loads(raw).get("handoff") == weakening:
                return 200, b'{"status":"approved","access_token":"synthetic"}', {}
            return None

    override[0] = weakened
    with pytest.raises(RuntimeError):
        probe.machine_handoff_deny_probe(port)


def test_redirect_is_not_followed(probe, broker_harness):
    port, requests, override, _ = broker_harness
    override[0] = lambda _handler, _request: (
        302,
        b"",
        {"Location": f"http://127.0.0.1:{port}/trap"},
    )
    with pytest.raises(
        RuntimeError, match="packaged_machine_deny_failed:omitted_handoff"
    ):
        probe.machine_handoff_deny_probe(port)
    assert requests == ["/v1/access/request"]


def test_probe_deadline_and_chunk_limits(probe):
    class SlowResponse:
        reads = 0

        def read1(self, _limit):
            self.reads += 1
            return b" "

    response = SlowResponse()
    with pytest.raises(ValueError, match="response_timeout"):
        probe._bounded_json(response, 0)
    assert response.reads == 0
    with pytest.raises(ValueError, match="response_chunk_limit"):
        probe._bounded_json(response, float("inf"))
    assert response.reads == 32


def test_synthetic_environment_cannot_inherit_user_settings_or_keys(probe):
    parent = {
        "PATH": "/synthetic/bin",
        "SystemRoot": "C:\\Windows",
        "TEMP": "/synthetic/tmp",
        "FOURALLPASS_BROKER_TOKEN": "synthetic-parent-token-do-not-use",
        "FOURALLPASS_DATABASE_URL": "synthetic-parent-db-do-not-use",
        "FOURALLPASS_SIDECAR": "1",
        "PYTHONPATH": "/synthetic-untrusted",
        "OPENAI_API_KEY": "synthetic-parent-key-do-not-use",
        "HOME": "/synthetic-home",
    }
    environment = probe.isolated_sidecar_environment(parent)
    assert environment == {
        "PATH": parent["PATH"],
        "SystemRoot": parent["SystemRoot"],
        "TEMP": parent["TEMP"],
        "FOURALLPASS_BROKER_TOKEN": probe.SYNTHETIC_BROKER_TOKEN,
    }
    assert parent["FOURALLPASS_BROKER_TOKEN"] == "synthetic-parent-token-do-not-use"


def evidence(probe):
    return {
        "source_commit": "synthetic-source",
        "sidecar_sha256": "synthetic-binary",
        "license_sha256": "synthetic-license",
        "isolated_packaged_sidecar_database_startup": True,
        "packaged_ui_and_ap4_favicon_served": True,
        "packaged_machine_handoff_deny_v1": True,
        "machine_handoff_deny_checks": list(probe.DENY_CASES),
    }


@pytest.mark.parametrize(
    "field",
    [
        "source_commit",
        "sidecar_sha256",
        "license_sha256",
        "isolated_packaged_sidecar_database_startup",
        "packaged_ui_and_ap4_favicon_served",
        "packaged_machine_handoff_deny_v1",
        "machine_handoff_deny_checks",
    ],
)
def test_old_or_incomplete_package_evidence_cannot_skip_probe(probe, field):
    current = evidence(probe)
    previous = dict(current)
    assert probe.reusable_startup_evidence(previous, current)
    del previous[field]
    assert not probe.reusable_startup_evidence(previous, current)
    assert not probe.reusable_startup_evidence(None, current)


def test_existing_startup_check_records_deny_only_after_probe_and_uses_temp_cwd(
    probe, monkeypatch, tmp_path
):
    spec = importlib.util.spec_from_file_location(
        "release_check", ROOT / "scripts/check-release-license.py"
    )
    release_check = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(release_check)
    observed = {}

    class Process:
        def __init__(self, argv, **kwargs):
            observed.update(argv=argv, **kwargs)

        def poll(self):
            return None

        def terminate(self):
            observed["terminated"] = True

        def wait(self, timeout):
            return 0

    monkeypatch.setattr(release_check.subprocess, "Popen", Process)
    monkeypatch.setenv("FOURALLPASS_BROKER_TOKEN", "synthetic-user-token-do-not-use")

    def urlopen(url, timeout):
        if url.endswith("/api/v1/health"):
            return io.BytesIO(b'{"database":true,"profile":"local"}')
        data = (
            (ROOT / "brand/ap4/dark/4allpass-dark-32.png").read_bytes()
            if url.endswith("/favicon.png")
            else b"4AllPass"
        )
        response = io.BytesIO(data)
        response.status = 200
        return response

    monkeypatch.setattr(release_check.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(
        release_check,
        "machine_handoff_deny_probe",
        lambda _port: {
            "packaged_machine_handoff_deny_v1": True,
            "machine_handoff_deny_checks": list(probe.DENY_CASES),
        },
    )
    result = {"source_commit": "synthetic"}
    release_check.startup_check(tmp_path / "not-a-real-binary", tmp_path, result)
    assert result["packaged_machine_handoff_deny_v1"] is True
    assert observed["env"]["FOURALLPASS_BROKER_TOKEN"] == probe.SYNTHETIC_BROKER_TOKEN
    assert observed["cwd"] == tmp_path and observed["terminated"]

    def fail(_port):
        raise RuntimeError("synthetic_probe_rejected")

    monkeypatch.setattr(release_check, "machine_handoff_deny_probe", fail)
    failed = {"source_commit": "synthetic"}
    with pytest.raises(RuntimeError, match="synthetic_probe_rejected"):
        release_check.startup_check(tmp_path / "not-a-real-binary", tmp_path, failed)
    assert "packaged_machine_handoff_deny_v1" not in failed
