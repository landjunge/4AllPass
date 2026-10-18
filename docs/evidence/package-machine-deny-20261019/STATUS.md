# FP-V01 — package machine-denial guard / Paket-Sperrnachweis

19 October 2026 (Europe/Berlin); recorded 18 October 2026, 22:46 UTC.
Base: `a983814a582c913fd27663c529e0d007225b1071` (merged PR224).

## Ursache und Korrektur / Cause and correction

Der vorhandene Paketstartcheck belegte Datenbank/UI/AP4-Favicon, aber nicht die
Sperre der maschinellen Geheimnisübergabe. Auch diese alten Startbelege konnten
für einen identischen Kandidaten wiederverwendet werden. Der synthetische
Start erbte außerdem die Benutzerumgebung, einschließlich eines vorhandenen
`FOURALLPASS_BROKER_TOKEN`; sein CWD konnte eine Projekt-`.env` lesen.

The existing package checker now starts its candidate with an allowlisted
minimal environment, fixed public synthetic pairing token, temporary cwd and
explicit temporary data directory. It sends eight actual loopback requests to
the candidate: omitted/raw_secret/mediated must return exactly
`denied/handoff_unavailable`; missing/wrong token and foreign/null/local-browser
Origin must keep their existing 401/403 denials. Exact response shape rejects
material/additional/duplicate fields. No redirects or environment proxies;
512-byte/32-read response limits, one-second socket inactivity timeout and
12-second total deadline checked between reads. No remote URL input or new API.
Failures expose only fixed case names, never response bodies or exception text.

Existing evidence receives the new `packaged_machine_handoff_deny_v1` flag and
eight named checks only after success. Reuse requires those checks plus exact
source/binary/LICENSE hashes and the existing database/UI startup evidence.
Historical records are not modified. This does not authenticate GitHub or the
host, protect browser sessions, implement a production executor or settle costs.

## Tatsächliche gezielte Prüfung / Actual targeted checks

- **23 new tests passed, 0.84s:** new package-guard suite only. The positive probe
  uses the unchanged actual `app.broker` FastAPI router through a synthetic local
  HTTP/ASGI harness, without database/vault/account/provider/model use. It checks
  all eight denials, empty request queue, no inherited proxy, secret-shaped and
  malformed/oversized/additional/duplicate output rejection, explicit raw/
  mediated/token/origin regressions, redirect trap not reached, deadline/chunk
  limits, minimal environment and incomplete/old evidence refusal. A mock
  process/HTTP startup harness separately verifies actual checker wiring,
  synthetic token/cwd, positive evidence and missing evidence on failed probe.
- After narrowing expected transport/JSON exception handling to explicit safe
  exception types and formatting, **8 affected handler/output cases passed,
  15 deselected, 0.30s**. No unchanged whole-product suites were repeated.
- Ruff check and format passed for all three changed Python files; diff check
  passed. No frontend, backend product policy, vault, cryptography or native
  application code changed. New backend test is included by existing CI
  discovery; no new CI job or manual workflow dispatch was added.
- Dated DE/EN current-state notes correct active instructions in the docs index,
  short demo and historical freeze. The outdated current prompt description is
  corrected in the authoritative boundary. Historical demo/freeze body and all
  existing release/build evidence remain retained and explicitly historical.

Reproduce only these new tests from the checkout's `backend` directory using the
existing backend development environment (not a personal database):

```sh
PYTHONPATH=. \
FOURALLPASS_DATABASE_URL=sqlite+aiosqlite:///:memory: \
FOURALLPASS_TEST_DATABASE_URL=sqlite+aiosqlite:///:memory: \
FOURALLPASS_SESSION_BACKEND=memory \
FOURALLPASS_SESSION_SECRET=synthetic-package-tests \
python -m pytest -q tests/test_package_machine_deny.py
```

## Offen / Actual remaining limits

**No new binary was built, installed, signed, released or tested here.** The
candidate-binary denial check is implemented, but its first actual packaged
execution remains for the next separately authorized build. The local handler
and mocked startup tests are not relabeled as binary acceptance.

Public `v0.1.2-rc.2` / built `60eef0a` still contains the historical raw-material
channel. This source change does not fix installed copies or silently update
download/installer targets. No release/tag/hash/signature or AP4/LICENSE change.

FP-C02/FP-C03 still need a genuinely agent-inaccessible OS/file/shell/debug secret
boundary, trusted vault transfer, authenticated host/consent origin and lifecycle
source, and a concrete controlled browser operation with session-ending evidence.
Human autofill deliberately allows the destination page to read its field value;
an unrestricted agent browser is not a protected login. Existing stranger-Mac,
Apple-notarization and independent-audit gaps remain their separate requirements.

## Integration / Rückweg

Review this single source/checker/documentation slice against current main.
Reverting it restores the old package-check acceptance and inherited environment,
not a recommended release posture; it does not restore the denied machine policy
or migrate/delete user data. Keep old evidence unchanged and never assign the
new flag to an old untested binary.
