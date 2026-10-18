# FP-C01 / FP-C02 / FP-R01 — cause, implementation and limits

Order: `seven-tools-build-20261018-1833`. Base: main `82bf0f8`.
Worker: Codex `/root/fourallpass_protected`, isolated worktree
`.worktrees/seven-tools-protected-20261018`. No release/deployment/vault changes.

## Cause and trust boundaries

| Path | Plaintext visible to | Use / end | Current correction |
|---|---|---|---|
| Human unlocked desktop vault | Human client | Copy, import, autofill, recovery; existing lock paths | Preserved, no crypto change |
| Legacy machine core → UI grant | UI read `entry.password` into `material` | `approvedResponse` returned it as `access_token` | No available core handoff; frontend never copies password; stale grants denied |
| Python sidecar / Node relay | Previously forwarded UI material | Machine received a reusable provider credential | Access requests fail closed; old decision data projected to fixed denial |
| Access SDK | Previously parsed `access_token` | Caller retained copy outside TTL | Reject stale approved responses; reason whitelist; fixed transport errors |
| Protected API building block | Private trusted host only, synthetic in tests | Fixed `demo.quota.read`; TG-ordered send; whitelisted result | Implemented core/adapter, no production entry point or real vault transfer |
| Agent-controlled browser | DOM/debug/session tools could read credentials | Cookie/session export not solved by autofill | FP-C03 remains blocked; no protected login claim |

`access_token` was the actual stored material, not a new scoped provider token.
Historic prioritization beyond the documented v1/later choice is unknown.
Raw handoff removal follows the user's explicit new no-secret-to-AI requirement.
A human Allow never overrides that requirement. Standing policy library metadata
is not connected to secret transport and does not re-enable this path.

## Fixed fachlicher API contract / fixed application contract

The core only accepts `demo.quota.read` at `demo-quota-v1`, a private grant reference
and G-01 project/workflow/task/actor/consumer/attempt/hash binding. There is no
caller URL, method, headers, body, shell, field selector, echo or export API.
The trusted transport must synchronously finish its bounded operation inside
TollGate's actual dispatch callback. No deferred send or automatic retry.

The response contract allows exactly `remaining: integer 0..100000` and
`window: day|month`. Unknown/duplicate fields, redirects, encoded secret strings,
unbounded bodies and generic provider errors are rejected. No arbitrary JSON or
provider body is returned. The result is `delivered_unverified`, never user/project
acceptance; cost settlement is explicitly separate. Same-attempt replay reads
TollGate's existing attempt and never sends again; result data held only in a
previous process is not invented after restart.

Actual dependency: TollGate `workflow_control.py`, worker commit `025b2476b0cba7d5fe1f86a0a117c3a8f86eac8b`
(current compatible worker tree). FP's adapter imports its real
`WorkflowControl`, `AttemptIdentity`, `WorkflowScope`, and `Quote` interface.
No copied Allow-token substitute. No compatible gate/import or budget/registry
means no dispatch. The synthetic zero-cost quote cannot authorize a paid API.

## Abnahme / acceptance

- Core access policy: 27 tests passed; SDK 9; Node relay 6.
- Backend broker: 9 tests passed, isolated SQLite/local runtime only.
- Protected core + actual TollGate adapter: 20 tests passed (synthetic, isolated
  journal), including same-attempt restart/no-double-send, durable stop,
  grant/actor/project/task mismatch, expiry/revoke, missing gate, redirect,
  direct/encoded echo/export, duplicate fields, bool-as-int and response limits.
- Frontend workspace: 184 tests passed. All workspace typechecks and module boundaries passed.
- Real loopback dummy HTTP GET through the actual TollGate adapter passed; synthetic Authorization stayed at dummy target.
- UI acceptance is recorded in docs/evidence/protected-access-20261018 (see scope in ui-proof.json).

Commands use the existing Python environment, never a personal vault:

```sh
npm test -w @4allpass/core
npm test -w @4allpass/access
npm test -w @4allpass/broker
npm test -w @4allpass/frontend
npm run typecheck
# from backend: existing venv pytest tests/test_access_broker.py with isolated SQLite
# from repo: PYTHONPATH=.:<matching-tollgate-source>/src existing-venv-python -m pytest -q protected_executor/tests
```

## Explicit remaining prerequisites

FP-C01 and raw-channel hardening are implemented; FP-R01 source claims updated.
FP-C02 has an implemented/tested core but is **not complete or deployed**.
The observed local macOS environment gives the same human UID project/shell
access. Another process or a 0600 file under that UID is not a secret boundary.
Production needs an actually inaccessible executor/secret-handoff boundary,
trusted vault-to-executor transfer without generic tool output, KB-C02 origin
binding/authentication, and a concrete provider adapter enforcing its target,
timeout and true cost bound. No new OS account, sudo, secrets store, service,
provider account or paid action was created to simulate these prerequisites.
FP-C03 browser/session isolation remains unimplemented.

Public v0.1.2-rc.2 artifacts/source `60eef0a` and all historical releases are
unchanged. This branch does not update a user's installation. AP4/LICENSE and
startup fixes remain in its main ancestry; no icon or crypto redesign.

Rollback is a source revert/rebuild decision, not a safe security default: it
would reopen the historical raw-material behavior. No data/schema migration was
made and no existing journal, credential or vault was deleted.
