# E03 / P02–P04 — IndexedDB transaction completion

20 October 2026. Base `262917f0a5a1e2bebe136c4710d58522b29e5fd4`.
This is one local persistence correction, not acceptance of all E03.
Exact source hashes, commands, durations and outcomes: [results.json](results.json).

## Verdict

**ship-with-nits for the bounded local change:** relevant local checks pass;
independent Grok review and integration remain pending. No package or installed
application was updated by these checks.

## Claims vs reality

Both snapshot-cache and device-unlock-record operations previously resolved on
request success. A later transaction abort could roll back the write or removal
after callers had received success. Loads also returned before transaction end.

Both existing local helpers now retain the request result and resolve only on
transaction completion. Transaction abort/error and request failures reject.
Connections still close through the existing finally blocks. No shared storage
framework, dependency, envelope, key or unlock mechanism was introduced.

Online unlock continues to treat cache saves as best-effort. Offline load errors
propagate before the cached snapshot can open. Device provisioning/unlock/removal
already await their store operations; their existing fallback and best-effort
cleanup behavior remains. Completion does not promise protection against browser
eviction, power failure or disk loss, and does not prove authenticator possession.

## Findings

### E03-PERSIST-01 — success before commit · medium · existing

The old `transact` in `frontend/src/lib/snapshot-cache.ts` and
`packages/webauthn/src/store.ts` had neither completion nor abort handlers.
In real Chrome IndexedDB, aborting in a request-success listener produced a
successful public promise although save/remove had been rolled back.

The regression tests independently control request and transaction events for
save/load/remove in each store. They check pending-until-complete, abort before
and after request success, abort without an error object, request errors,
transaction errors and connection closure. Removing the fix breaks these tests.
No historical regression or confidentiality bypass is claimed.

## Invariants

- [x] Crypto, manifest verification, freshness pins and caller expectations unchanged.
- [x] Account authentication/ownership remain separate from device/key proof.
- [x] No backend plaintext, machine handoff or new real credential introduced.
- [x] Separate module boundaries retained; only synthetic records used for checks.

## Tests

| Check | Result |
| --- | --- |
| Current regression files against copied base modules at `262917f` | 39 tests: 9 pass, **30 expected failures**, exit 1 |
| Corrected targeted cache/store tests | **39 pass**, no skips, exit 0 |
| `npm test -w @4allpass/frontend` | **202 pass**, no skips |
| `npm run test:webauthn` | **44 pass**, no skips |
| Frontend and WebAuthn workspace typechecks | pass |
| Frontend lint | exit 0; warnings in untouched files |
| Module boundary check and `git diff --check` | pass |
| Real Chrome IndexedDB against base `262917f` | **12 expected failures**, exit 1 |
| Real Chrome IndexedDB against corrected modules | **12 pass**, exit 0 |

The real-browser command is:

```sh
node scripts/verify-indexeddb-transactions.mjs
node scripts/verify-indexeddb-transactions.mjs 262917f0a5a1e2bebe136c4710d58522b29e5fd4
```

The second command deliberately returns exit 1 for the old behavior without
changing the checkout. The script uses installed Chrome, fresh contexts for
each store/operation/commit-or-abort case, and only synthetic records. Page
requests are fulfilled from in-memory fixtures or blocked; no app, backend or
HTTP server starts. These are native browser IndexedDB events, including
`IDBTransaction.abort()` and a subsequent native read of persisted state.
Timeouts count as failures. Aborted save leaves no new record; aborted removal
preserves the original record; aborted load rejects. All 24 recorded browser
cases settled without timeout. Chrome version: **155.0.8059.85**.

The whole frontend/WebAuthn workspaces ran once. After increasing only test
watchdogs and bounding the browser harness, the affected targeted and browser
checks were repeated. Backend, other workspaces and product/browser profiles
are outside this local change. There was no WebAuthn/PRF ceremony or native
package acceptance. H1 and the larger AP-04 identity contract remain separate.

## Tests I would add

The concrete transaction-event regressions and real IndexedDB rollback probes
needed for this fix are included. Power-loss/eviction behavior requires its own
defined operational scope; this change makes no such durability claim.
