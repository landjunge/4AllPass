# E03 / P02 — legacy manifest migration G1

Base: `101582b4cf4faad5b9413dcbcd4cc42bf878498a` (origin/main).
Branch: `fix/ap-e03-p02-migration-g1-20261113`.
Contract: `docs/vault-revision.md` §3.1.1; private review draft `AP-E03-P02-MIGRATION-CONTRACT-v1`.

## Scope implemented

- Explicit per-vault opt-in (no automatic commit at unlock/install); DE/EN notice
  and “Update now / Later” banner; declining keeps the legacy vault readable and
  normal write contracts unchanged.
- Durable ciphertext wire backup of the legacy snapshot is verified **before** the
  first POST; failure aborts with no POST.
- Forward re-commit uses the existing `sealManifest` / `commitSnapshot` path at
  `N+1` under the same Vault Key, with existing CAS, echo verification and lock
  epoch. It attests the opened set; it does **not** claim the legacy revision/set
  was original.
- Unknown outcome: no retry from a read. Only the exact expected revision plus the
  prepared sealed-manifest digest (verified) counts as success. A still-legacy head
  is not proof of non-acceptance; the client reports unknown and blocks a blind
  retry.
- 409: load and verify the winning head; no overlay, no loop, no second POST.
- Set integrity: the wire entry-id set and envelope identity set must match the
  opened state; otherwise a concrete stop, no migration.
- No new crypto, manifest schema, cryptoProtocolVersion, backend endpoint or
  server-side migration. No client-local F-25 counter.

## Targeted evidence

| Check | Result |
|---|---|
| New `frontend/src/lib/vault-session.legacy-migration.test.ts` | 15/15 pass (MIG-1..13, 15 incl. MIG-4b/6/7/8) |
| Directly affected existing tests (`commit-echo`, `pin-content`, `head-recovery`, `freshness`, `offline`, `hard-revoke`, `history`, `nonce-budget`, `lock-epoch`, `pull-local-lock`) | 48/48 pass |
| `tsc` frontend app for changed files | no errors from this change; 10 pre-existing `agent-access` errors from the local workspace dependency state, outside this diff |
| `tsc` node/test project | pass |
| `oxlint` changed files | no new errors; pre-existing app-shell hook/fast-refresh warnings remain |

No full suite was run (as scoped).

## Deliberately not activated

- MIG-14 / G2 / G3: first-use manifest requirement and coverage/exception gates
  are still open. Legacy vaults remain readable with the notice; no lockout.
- F-25 (no persistent seal counter/rotation) remains separately open; this change
  adds no counter and no crypto-agility decision.

## Rollback

Client-side: the legacy wire snapshot is backed up before the effect and the old
revision remains immutable/readable. A failed/declined/unknown migration does not
delete the legacy head or persist plaintext/keys. No server/schema migration.

## Remaining gates

1. Contract/UX review of the DE/EN notice and the rollout coverage/exception policy.
2. A real render/e2e of the banner (not run here; no browser/WKWebView).
3. MIG-14/G2/G3 activation only after coverage/exception.
4. F-25 separate ADR/implementation.
