# E03.3 / H1 / R03 — central account registration

20 October 2026. Base `262917f0a5a1e2bebe136c4710d58522b29e5fd4`.
Source change independently reviewed by a separate native Codex agent; CI and integration remain separate gates. No package, installation or release.

New account registration requires 15–256 Unicode code points and checks the
entire candidate against a [pinned offline list](../../account-password-policy.md).
The generated constant retains the upstream MIT notice and can be rebuilt
offline from the reviewed source hash. No password, hash or prefix is sent to
a third party. Account login keeps its existing full verification, including
older 12–14-character and newly listed passwords. Local bootstrap and vault
passwords remain separate.

Registration validation returns fixed error codes instead of FastAPI's rejected
input. This also prevents an escaped lone surrogate from breaking error JSON
serialization. Unrelated endpoints retain the previous validation handler.
The frontend counts code points before registration and maps only known policy
codes to DE/EN guidance; unknown API details remain hidden. No hash migration,
password truncation, composition requirement or periodic reset was introduced.

## Red evidence

- Actual ASGI application/schema/routes with isolated replacement adapters:
  **12 failed / 12 passed** before the change. The relevant auth/schema/main/hash
  sources were identical between that preparation and base `262917f`.
  Reproduced short/whole-listed registration acceptance, rejected-input echo,
  and the lone-surrogate validation serialization failure. Existing hash/login
  compatibility and full 256-emoji UTF-8 verification already passed.
- Actual `AuthPage`, account commands and feedback code in fresh Chromium with
  a synthetic account context, DE and EN: **8 failed / 6 passed** against base
  `262917f`. No page errors. This is a component interaction check, not native
  installation or a full account/backend journey.

## Checks on the change

| Check | Result | Limit |
| --- | --- | --- |
| H1 ASGI/Unicode/legacy-hash cases | 25 passed, no skips | Replacement DB/session adapters; existing full UTF-8 Argon2 exercised separately |
| Backend `pytest -q` | 181 passed, 1 skipped | Fresh temporary SQLite, memory sessions; Postgres-only migration round trip explicitly skipped |
| Frontend workspace tests | 188 passed, no skips | Node tests; no native hardware claim |
| Frontend typecheck | Exit 0 | TypeScript |
| Frontend lint | Exit 0 | 12 warnings in existing untouched files |
| Module boundary check | Exit 0 | Existing limited import check |
| Offline blocklist `--check` | Exit 0 | Pinned 100000-row public source; 72 eligible rows / 70 unique keys |
| Chromium component checks | 14 passed, no page errors | DE/EN: short ASCII/codepoints, 257/15/256 emoji, blocklist reason, old 12-character login |

The backend helper removed inherited `FOURALLPASS_*` variables, asserted no
backend `.env`, and configured a new temporary database and data directory before
imports. No production database, personal account, real vault or browser profile
was used. Environment: Python 3.12.13, Node 25.9.0, locked existing dependencies.
The full backend check preceded a spelling/import/status-constant cleanup;
the 25 affected API cases were rerun afterward. No runtime semantics changed.

[Machine-readable receipt](checks.json) records commands and selected results.
Private detailed logs and the Chromium harness are retained in the existing
continuation evidence directory. The checked-in backend/frontend cases remain
rerunnable through the normal repository test commands.

Independent Codex review and CI are separate gates; the exhausted Grok quota is not a pending approval requirement. P01–P05, AP-04, broader
E03, server deployment, hardware, packages and an overall NIST assessment remain
outside this bounded H1 result. No general NIST-conformance claim is made.

Source file digests are in `SHA256SUMS`; `checks.json` references that file.
The original nine digests were checked against the actual source bytes; the aligned legacy config is included as a tenth entry. This replaces
a hash map whose auth/password path keys triggered six generic-key scanner
findings; no credential, scanner rule or application code was changed.

Independent native Codex review of d81ce56 found no functional/security blocker:
68 targeted checks passed, including 31 additional reviewer cases. Evidence-only
head d6912eb preserved the reviewed code. After integration rebase onto 45331a3,
the unused legacy auth_min_password_length default is aligned with 15 and clearly
marked non-authoritative; registration still uses its fixed schema policy.
Daniel explicitly directed continuation without Grok after quota exhaustion.
The earlier Grok H1 receipt is not an independent approval.

After the integration rebase and config alignment, the 25 affected H1 API
cases passed again in a fresh isolated SQLite/memory-session environment.
