# E03 / P04 / R05 — exact origin and ceremony context

Base: `262917f0a5a1e2bebe136c4710d58522b29e5fd4`, 20 October 2026.
Initial implementation independently reviewed by a separate native Codex agent; review follow-up checks and integration are recorded below. This does not close all E03 or establish a production AP04 identity.

## Findings and correction

The old verifier derived allowed origins by replacing substrings. Configuring
only `https://localhost.example.test` also accepted an otherwise valid software
registration from `https://127.0.0.1.example.test`. Both registration and signed
assertion verification also accepted an unapproved cross-origin context or a
foreign `topOrigin`. These are relying-party policy gaps; this probe establishes
no vault decryption, account takeover or physical-authenticator exploit.

The existing verifier now expands only literal HTTP(S) localhost/127.0.0.1
hostnames at the same port, and only for local/development/testing use. Other
server environments accept exactly configured origins and RP ID. Domain
substrings, userinfo, paths and custom app schemes are never rewritten.

Both ceremonies reject `crossOrigin=true`, invalid Boolean values and a foreign
`topOrigin`. A matching `topOrigin` remains accepted. Older clients may omit
`crossOrigin`. Expected-origin, challenge, RP hash, UV and signature verification
still run in the pinned library; the change does not replace cryptography.
The concrete contract is `docs/webauthn-prf.md` §2.5, with the authoritative
[WebAuthn Level 3 relying-party operations](https://www.w3.org/TR/2026/REC-webauthn-3-20260825/#sctn-rp-operations).
Same-origin-only embedding is the app's supported profile, not a claim that
WebAuthn universally prohibits cross-origin embedding.

## Actual checks

Python3.12.13, macOS15.7.4 Intel, pinned `webauthn==2.7.0`. Synthetic software
COSE keys only; no account, authenticator, user browser profile or service used.
Every backend run clears inherited `FOURALLPASS_*`, uses a fresh temporary
SQLite database and memory sessions, and imports this checkout via PYTHONPATH.

| Final check | Result |
| --- | --- |
| Final 26 policy cases against copied base verifier/config/fixture blobs | 18 expected failures, 8 pass |
| Policy, existing COSE and challenge modules | 35 pass |
| Entire backend after final policy adjustment | 182 pass, 1 existing Postgres-only migration skip |
| `git diff --check` | pass |

The baseline cases are the final test file, not the earlier draft oracle. During
self-review a matching `topOrigin` was kept compatible with the W3C guidance;
the final baseline and complete backend checks were run after that adjustment.
An initial targeted invocation named a nonexistent plural challenge file and
ran no tests; the corrected singular file is in the successful 35-case run.

Target command (only with explicitly isolated test settings):

```sh
python -m pytest -q tests/test_webauthn_policy.py tests/test_webauthn_cose.py tests/test_webauthn_challenge.py
```

The policy cases cover exact configured production origins, explicit dual
loopback origins, development/local aliases, domain/path/userinfo/custom-scheme
non-expansion, valid registration/assertion, actual signature failure, unapproved
cross-origin data and backward-compatible same-origin data. Signed negative
assertions use their correctly recomputed signature, so context rejection is
not accidentally proved by an invalid signature.

The full SQLite run does not establish Postgres/Redis behavior, a real browser
or PRF ceremony, native desktop compatibility, enrollment ownership, TLS, a new
package or installed application. Those remain separately scoped. No runtime
configuration, credentials, permissions or existing sessions were changed.

Daniel explicitly directed continuation without Grok after its weekly quota
was exhausted. Independent review of this slice is therefore assigned to a
different native Codex agent; it is not represented as a Grok review.

## Independent review follow-up

The independent review of `eabacdb` reported no blocking finding, with three
small follow-ups. The alias generator now requires the configured origin to
match its canonical spelling exactly before deriving a loopback counterpart;
URL parsing cannot silently strip whitespace, control characters, an empty
port or leading zeroes to grant another alias. Required client-data fields are
validated as strings, and known library parsing/decoding failures become the
existing ceremony error instead of an internal server error. Signature and
other cryptographic verification remain with the pinned library.

Fourteen added cases against the first candidate produced 12 failures and two
passes. After the corrections, all 49 policy/COSE/challenge cases passed. The
182-case complete-backend result above belongs to the earlier candidate;
fresh CI must validate the final head. These are synthetic verifier checks,
not hardware or complete AP04 enrollment proof.

The final policy delta at e390135 received an independent Codex ship: 21 own
checks, including 16 real isolated ASGI HTTP cases returning 422, one systematic
76-variant alias test and four valid legacy/same-origin ceremonies. The
integration rebase onto H1 main f547b3b preserves the reviewed verifier/test
bytes; fresh full-backend and CI results are separate from those reviews.
