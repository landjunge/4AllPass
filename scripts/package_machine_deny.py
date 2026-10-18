"""Bounded, synthetic machine-handoff checks for the existing packaged sidecar.

Only the package-check process uses these helpers; no public API or credentials.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from http.client import HTTPException

SYNTHETIC_BROKER_TOKEN = "package-check-only-not-a-real-pairing-token"
DENY_CASES = (
    "omitted_handoff",
    "raw_secret",
    "mediated",
    "missing_token",
    "wrong_token",
    "foreign_origin",
    "null_origin",
    "local_browser_origin",
)


def isolated_sidecar_environment(parent):
    # Do not inherit user credentials, FOURALLPASS_* settings or Python hooks.
    # The actual data directory and cwd are also synthetic (set by the caller).
    allowed = {
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "TMP",
        "TEMP",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
    }
    environment = {
        key: value for key, value in parent.items() if key.upper() in allowed
    }
    environment["FOURALLPASS_BROKER_TOKEN"] = SYNTHETIC_BROKER_TOKEN
    return environment


def reusable_startup_evidence(previous, current):
    """Historical health-only evidence cannot certify the new machine check."""
    return (
        type(previous) is dict
        and all(
            previous.get(key) == current[key]
            for key in (
                "source_commit",
                "sidecar_sha256",
                "license_sha256",
            )
        )
        and all(
            previous.get(key) is True
            for key in (
                "isolated_packaged_sidecar_database_startup",
                "packaged_ui_and_ap4_favicon_served",
                "packaged_machine_handoff_deny_v1",
            )
        )
        and previous.get("machine_handoff_deny_checks") == list(DENY_CASES)
    )


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _bounded_json(response, deadline):
    data = bytearray()
    # read1 returns available bytes instead of waiting indefinitely for a full
    # buffer; inactivity timeout plus deadline/chunk/byte caps bound the probe.
    for _ in range(32):
        if time.monotonic() >= deadline:
            raise ValueError("response_timeout")
        chunk = response.read1(513 - len(data))
        if not chunk:
            break
        data.extend(chunk)
        if len(data) > 512:
            raise ValueError("response_limit")
    else:
        raise ValueError("response_chunk_limit")

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("duplicate_field")
            result[key] = value
        return result

    return json.loads(data, object_pairs_hook=unique)


def machine_handoff_deny_probe(port):
    """Exercise the actual binary, never accept caller URLs or follow redirects.

    8 fixed requests, at most 512 response bytes/32 reads each, 1-second socket
    inactivity timeout and 12-second overall deadline (checked between reads).
    No response body, header, exception text or token enters output/evidence.
    """
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("invalid_package_probe_port")
    origin = f"http://127.0.0.1:{port}"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    deadline = time.monotonic() + 12
    for case in DENY_CASES:
        try:
            if time.monotonic() >= deadline:
                raise ValueError("probe_timeout")
            body = {
                "application": "package-check",
                "provider": "synthetic",
                "scope": ["synthetic.read"],
                "ttl": 15,
            }
            headers = {"Content-Type": "application/json"}
            if case != "missing_token":
                token = (
                    "package-check-wrong-token"
                    if case == "wrong_token"
                    else SYNTHETIC_BROKER_TOKEN
                )
                headers["Authorization"] = f"Bearer {token}"
            if case in {"raw_secret", "mediated"}:
                body["handoff"] = case
            if case.endswith("origin"):
                headers["Origin"] = {
                    "foreign_origin": "https://untrusted.invalid",
                    "null_origin": "null",
                    "local_browser_origin": origin,
                }[case]
            expected_status = (
                401
                if case.endswith("token")
                else 403
                if case.endswith("origin")
                else 200
            )
            expected_reason = (
                "handoff_unavailable" if expected_status == 200 else "malformed_request"
            )
            request = urllib.request.Request(
                origin + "/v1/access/request",
                data=json.dumps(body).encode(),
                headers=headers,
                method="POST",
            )
            try:
                response = opener.open(request, timeout=1)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                if response.status != expected_status:
                    raise ValueError("unexpected_status")
                value = _bounded_json(response, deadline)
                if value != {"status": "denied", "reason": expected_reason}:
                    raise ValueError("unexpected_denial")
        except (OSError, ValueError, HTTPException):
            # Untrusted old binary/body/transport errors must not leak contents.
            raise RuntimeError("packaged_machine_deny_failed:" + case) from None
    return {
        "packaged_machine_handoff_deny_v1": True,
        "machine_handoff_deny_checks": list(DENY_CASES),
    }
