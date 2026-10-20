# E03 / AP04 prerequisite: explicit device assertion selectors

Tested on `3715120`, 20 October 2026, Python 3.12.13, pinned webauthn 2.7.0.
Source correction only; independent review, PR/CI and integration remain gates.
No real account, vault, authenticator, user browser, service, permission or
credential was changed. No Grok quota used.

The actual ASGI routes with two synthetic SQLAlchemy device rows and software
COSE keys previously accepted a B assertion for an explicitly selected A device.
Seven regression cases against unchanged main: 2 failures/5 passes. No process-
local candidate endpoint replacement was used; these exercise the actual route.
After the two added comparisons, 56 affected policy/COSE/challenge/device-binding
cases passed. Full isolated SQLite backend: 228 passed, 1 existing Postgres-only
migration test skipped. CI covers actual PostgreSQL separately.

The seven cases cover stored and consume-only selector mismatch without usage
stamps, matching assertion with stamps and replay rejection, changed/missing
bound consume selectors, unbound legacy assertion and unsigned hygiene consume.
The latter 204 responses deliberately carry no admission result. Mismatch uses
existing 404 and consumes its one-time challenge before the assertion checks.

The helper cleared inherited FOURALLPASS variables, refused a checkout .env,
used a fresh private SQLite/data directory and memory sessions, and imported this
checkout explicitly. Detailed command/exit/timing logs remain in the existing
private continuation evidence directory. SHA256SUMS records the exact source
and test bytes; none of the policy, crypto or challenge-store algorithms changed.

This does not complete AP04 enrollment/person mapping/revocation/team roles,
close account-session snapshot writes, prove hardware/PRF, add a production
host, install a package or change legacy account/vault auth behavior.

Independent native Codex review of 99b6372: ship. The reviewer executed 56 affected
cases and seven own actual ASGI edge/compatibility cases successfully. The same
seven own cases against a byte-verified non-Git archive of real base71 produced
five failures/two passes, without any endpoint hook. This review is separate
from the author's 228+1 complete backend run. Rebase onto H3 main 49256b3 leaves
both reviewed backend/test files byte-identical; final combined CI remains a gate.
