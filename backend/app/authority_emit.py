"""G5: Authority Event Envelope. Metadata only. Never a secret, never ThreadDesk DB."""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SOURCE = "4allpass"
FORBIDDEN = frozenset(
    {
        "secret",
        "secrets",
        "password",
        "passwd",
        "prompt",
        "credential",
        "credentials",
        "api_key",
        "apikey",
        "token",
        "access_token",
        "refresh_token",
        "raw_token",
        "master_password",
        "private_key",
        "vault_payload",
        "material",
        "raw_secret",
    }
)


def enabled() -> bool:
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return bool((os.environ.get("FOURALLPASS_AUTHORITY_EVENTS") or "").strip())
    raw = (os.environ.get("FOURALLPASS_AUTHORITY_EVENTS") or "1").strip().lower()
    return raw not in ("0", "false", "off", "no")


def events_path() -> Path:
    override = (os.environ.get("FOURALLPASS_AUTHORITY_EVENTS_PATH") or "").strip()
    if override:
        return Path(override).expanduser()
    data = (os.environ.get("FOURALLPASS_DATA_DIR") or "").strip()
    root = Path(data) if data else Path.cwd() / "data"
    return root / "authority-events.jsonl"


def _iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _canonical(event: dict[str, Any]) -> bytes:
    body = {k: v for k, v in event.items() if k != "event_hash"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode(
        "utf-8"
    )


def _hash(event: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(event)).hexdigest()


def _last_hash(path: Path) -> str | None:
    if not path.is_file():
        return None
    last = None
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                last = json.loads(line).get("event_hash")
            except json.JSONDecodeError:
                continue
    return str(last) if last else None


def emit_from_decide(req_id: str, body: dict[str, Any] | None) -> dict[str, Any] | None:
    """Append one envelope event. Ignores secret-bearing fields on the decide body."""
    if not enabled() or not isinstance(body, dict):
        return None
    status = str(body.get("status") or "").strip().lower()
    if status in ("approved", "granted"):
        event_type = "capability.granted"
        decision = "ALLOW"
    elif status in ("denied", "rejected"):
        event_type = "capability.denied"
        decision = "DENY"
    elif status in ("expired", "revoked"):
        event_type = "capability.revoked"
        decision = "DENY"
    else:
        return None
    try:
        path = events_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        wf = req_id.strip() or "4ap-local"
        app = str(body.get("application") or body.get("applicationId") or "").strip()
        provider = str(body.get("provider") or "").strip()
        scope = body.get("scope")
        cap = ""
        if isinstance(scope, list) and scope:
            cap = str(scope[0])
        elif isinstance(body.get("capability"), str):
            cap = body["capability"].strip()
        event: dict[str, Any] = {
            "schema_version": "1",
            "event_id": uuid.uuid4().hex[:16],
            "timestamp": _iso(),
            "trace_id": wf,
            "span_id": uuid.uuid4().hex[:8],
            "workflow_id": wf,
            "project_id": "4allpass",
            "source_tool": SOURCE,
            "event_type": event_type,
            "decision": decision,
            "action": "secret.read",
            "resource": f"app:{app}" if app else "4allpass:access",
            "previous_event_hash": _last_hash(path),
            "data_labels": ["PUBLIC"],
        }
        if cap:
            event["capability_id"] = cap
        if provider:
            event["resource"] = f"provider:{provider}"
        if any(k.lower() in FORBIDDEN for k in event):
            return None
        event["event_hash"] = _hash(event)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, ensure_ascii=True) + "\n")
        return event
    except Exception:
        return None
