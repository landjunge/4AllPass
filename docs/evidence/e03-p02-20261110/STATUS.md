# E03 / P02 — vault and snapshot lifecycle

Base: `de598604d3005517d6ecfc5d2f1f44c3d3cf6192` (after P00/P01, #262), rebased onto
`bcc397a` (#263, RUSTSEC-2026-0459). Environment as in `../e03-p00-p01-20261110/STATUS.md`.
Plan source and status: ThreadDesk (Big Plan `6b5b73b9de36`).

## Read

Frontend `lib/vault-session.ts` (fetch, open, accept, commit, create, rotations),
`revision-pin.ts`, `snapshot-cache.ts`, `historic-snapshot.ts`; extension
`unlock.ts`, `revision-pin.ts`; backend `services/snapshots.py`,
`api/routes/vaults.py`, `db/session.py`, `schemas/snapshot.py`; specs
`vault-revision.md`, `crypto/snapshot-integrity.md`, `security-boundary.md` §5.

Client and server roles stay separate: the backend stores opaque bytes and
enforces CAS (`revision == current + 1`, row lock / `BEGIN IMMEDIATE`, unique
`(vault_id, revision)`), VK monotonicity, master envelope present, manifest
required after revision 1, no revoked device envelope. All cryptographic checks
(manifest, pin, entry pass) are client-side.

## Findings fixed (reproduced, test fails when the fix is reverted)

| ID | Prio | Precondition → effect | Fix | Test |
|---|---|---|---|---|
| E03-P02-1 | B | Server (or anything answering the POST) returns the old, still authentic head with 200. `commitEntries` resolved: pin check said "same", the old head opened, the new entry vanished behind "saved". | `commitSnapshot` requires the returned revision and sealed-manifest digest to equal what was written, else `IntegrityError` (existing DE/EN message) | `vault-session.commit-echo.test.ts` |
| E03-P02-2 | C | Extension pinned at N, server replays N−k sealed under an earlier master password. Argon2id ran on the replayed envelope first; the rollback surfaced as `AuthFailureError` ("wrong password"). No data exposed. | `openUnlockedSnapshot` checks the pin before deriving | `extension/test/unlock.test.ts` "…old password as rollback" |

The head-recovery test mock now echoes the committed payload, as the backend
does (`test_snapshot_preserves_ciphertext_and_optional_manifest`).

## Evidence added

`vault-session.offline.test.ts`: after a real commit the offline cache contains
neither entry plaintext (title, user, password), the vault password nor the
Vault Key (base64/hex), and a tampered higher head does not replace it.

## Hardening needs (not changed)

- **First use without a pin accepts a manifestless head (B).** The server can
  then drop or mix entries for a new device. Current clients always seal at
  revision 1 and the backend refuses manifestless commits after it, so such a
  head is only legitimate for pre-manifest vaults. Closing it needs a migration
  (re-commit legacy vaults) before the client may require a manifest.
- Unreadable pin record is treated as "no pin" (needs local write access). C.
- Cross-tab pin save is not an atomic compare-and-set (documented, §5). C.
- `expectedRevision` is optional on the API; CAS still holds via
  `revision == current + 1`. No change.

## Test runs

| Command | Result |
|---|---|
| Frontend `npm test` | 265/265 |
| Extension `npm test` | 78/78 |
| Root `npm test`, typecheck, frontend lint | pass |
| Backend `pytest`, throwaway SQLite | 228 pass, 1 skip (PostgreSQL migration test) |
| Backend `pytest`, throwaway PostgreSQL 17 (`initdb` in `/tmp`, unix socket only, no TCP port) | 229/229, including concurrent writers, same-VK commit vs hard revoke, stale mirror PUT and migrations |

No real account, vault, user database, installed app or release was used.
