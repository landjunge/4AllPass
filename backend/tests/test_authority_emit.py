"""G5: decide metadata may be logged; access_token must not appear."""

from __future__ import annotations

import json
from pathlib import Path

from app.authority_emit import emit_from_decide


SECRET = "ghp_demo-must-never-land-in-the-envelope"


def test_emit_off_under_pytest_by_default(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("FOURALLPASS_AUTHORITY_EVENTS", raising=False)
    monkeypatch.setenv("FOURALLPASS_AUTHORITY_EVENTS_PATH", str(tmp_path / "x.jsonl"))
    emit_from_decide("req-1", {"status": "approved", "access_token": SECRET})
    assert not (tmp_path / "x.jsonl").exists()


def test_approved_event_has_no_secret(tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "authority-events.jsonl"
    monkeypatch.setenv("FOURALLPASS_AUTHORITY_EVENTS", "1")
    monkeypatch.setenv("FOURALLPASS_AUTHORITY_EVENTS_PATH", str(out))
    ev = emit_from_decide(
        "req-allow",
        {
            "status": "approved",
            "access_token": SECRET,
            "application": "n8n",
            "provider": "GitHub",
            "scope": ["repository.read"],
        },
    )
    assert ev is not None
    blob = out.read_text(encoding="utf-8")
    assert SECRET not in blob
    assert "access_token" not in blob
    assert "ghp_" not in blob
    row = json.loads(blob.strip())
    assert row["source_tool"] == "4allpass"
    assert row["event_type"] == "capability.granted"
    assert row["decision"] == "ALLOW"
    assert row["capability_id"] == "repository.read"
    assert row["workflow_id"] == "req-allow"


def test_denied_and_revoked(tmp_path: Path, monkeypatch) -> None:
    out = tmp_path / "authority-events.jsonl"
    monkeypatch.setenv("FOURALLPASS_AUTHORITY_EVENTS", "1")
    monkeypatch.setenv("FOURALLPASS_AUTHORITY_EVENTS_PATH", str(out))
    emit_from_decide("r1", {"status": "denied", "access_token": SECRET})
    emit_from_decide("r2", {"status": "expired"})
    lines = [json.loads(x) for x in out.read_text(encoding="utf-8").splitlines() if x.strip()]
    assert [e["event_type"] for e in lines] == ["capability.denied", "capability.revoked"]
    assert SECRET not in out.read_text(encoding="utf-8")
