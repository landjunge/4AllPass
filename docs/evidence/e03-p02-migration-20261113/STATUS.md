# E03 / P02 — legacy manifest migration G1

Base: `101582b4cf4faad5b9413dcbcd4cc42bf878498a` (origin/main).
Branch: `fix/ap-e03-p02-migration-g1-20261113`.
Contract: `docs/vault-revision.md` §3.1.1; private review draft `AP-E03-P02-MIGRATION-CONTRACT-v1`.

## Scope implemented

- Explicit per-vault opt-in (no automatic commit at unlock/install); DE/EN notice
  and “Update now / Later” banner; declining keeps the legacy vault readable and
  normal write contracts unchanged.
- **Separate durable legacy backup slot** (not the live-head cache): the migration
  stores the exact accepted **raw cipher wire** (unknown snapshot/entry/envelope
  fields included), reads it back through the same IndexedDB slot and compares a
  canonical JSON image plus the protocol entry/envelope digests before the effect.
  The successful `N+1` head cache write does not overwrite it; it remains available
  after commit and restart. Unknown fields the current commit schema cannot carry
  forward stop the migration before POST with a clear DE/EN message; the backup is
  retained instead of dropping metadata.
- **Legacy head cache keeps the raw wire:** `acceptSnapshot` stores the exact
  accepted raw wire for legacy snapshots (not a typed re-encode), so an offline
  reopen cannot drop unknown metadata before migration. A legacy snapshot without
  its raw wire fails closed instead of writing a lossy cache.
- **Atomic persistent reservation** (`vaultId`, `vaultKeyVersion`, `baseRevision`,
  `operationID`, prepared manifest digest, state; no secrets) in IndexedDB: one
  read-check-write transaction, owner `operationID` checked on every update, no
  localStorage fallback. It is claimed **before** the backup await, so independent
  tabs/modules cannot both pass an empty read, clobber a prepared receipt or both
  POST. Same-tab concurrent calls and a later reload/unlock/remount remain
  retry-blocked after UNKNOWN. Only a verified prepared manifest at the exact
  expected revision/digest (or a verified history receipt) resolves; a still-legacy
  head proves nothing.
- Forward re-commit uses the existing `sealManifest`/`commitSnapshot` path at
  `N+1` under the same Vault Key, with CAS, echo verification and lock epoch. It
  attests the opened set; it does not claim the legacy revision/set was original.
- 409: load and verify the winning head; no overlay, no loop, no second POST.
- Accepted-state integrity: defensive accepted raw wire + protocol
  `entryDigest`/`envelopeDigest` fingerprints + canonical plaintext string; same
  ids with changed payload/envelope/metadata or a getter replay stop before POST.
  The commit uses an immutable copy; the live entries/envelopes/revision are
  re-checked immediately before encryption, so a mutation during the backup await
  is 0 POST. The existing commit re-encrypts entries with fresh nonces; plaintext
  set and envelope bytes are preserved and the new manifest authenticates the
  ciphertext.
- Liveness is checked after async boundaries before `acceptSnapshot` and after its
  cache await; a late lock zeroizes the real key, leaves the pin unchanged and does
  not return an accepted vault. A newer pin written by another tab during the cache
  await also discards/zeroizes the opened key and never returns it.
- No new crypto, manifest schema, cryptoProtocolVersion, backend endpoint or
  server-side migration. No client-local F-25 counter.
- Own DE/EN README section for the migration banner; no `README: not needed`
  exception.

## Targeted evidence (own pinned workspace)

| Check | Result |
|---|---|
| `npm ci` in the isolated worktree (own lockfile/workspace) | completed; no root/foreign node_modules used |
| `npm run typecheck -w @4allpass/frontend` | pass, no errors |
| Node/test project `tsc` | pass |
| `vault-session.legacy-migration.test.ts` | 29/29 pass (MIG-1..13, 15, 16a-c, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27) |
| `legacy-migration-banner.test.ts` (synthetic DE/EN render) | 5/5 pass |
| `snapshot-cache.indexeddb.test.ts` (commit/abort + atomic remove) | 36/36 pass |
| Real Chromium (synthetic loopback) `vault-desk-legacy-migration.spec.ts` | 7 cases: DE/EN confirm, decline, UNKNOWN reload, lock, two-page reservation, real-IDB unknown-field backup, online unlock → offline reopen with backup equal |
| Directly affected existing tests (commit-echo, pin-content, head-recovery, freshness, offline, hard-revoke, history, nonce-budget, lock-epoch, pull-local-lock) | 48/48 pass |
| Targeted `oxlint` on changed files | no new errors; pre-existing app-shell hook/fast-refresh warnings remain |

No full suite was run (as scoped).

## Deliberately not activated

- MIG-14 / G2 / G3: first-use manifest requirement and coverage/exception gates
  remain open. Legacy vaults remain readable with the notice; no lockout.
- F-25 (no persistent seal counter/rotation) remains separately open; this change
  adds no counter and no crypto-agility decision.
- Real Chromium desktop evidence exists (synthetic loopback, headless, 1280×800);
  WKWebView/Tauri rendering is still not tested. The banner check is a synthetic
  server-render plus a synthetic wire fixture, not a product-vault migration.

## Remaining gates

1. Contract/UX review of the DE/EN notice, README wording and the rollout
   coverage/exception policy.
2. WKWebView/Tauri render and interaction (Chromium desktop is covered).
3. MIG-14/G2/G3 activation only after coverage/exception.
4. F-25 separate ADR/implementation.
