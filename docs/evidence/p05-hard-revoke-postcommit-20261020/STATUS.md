# P05/R06 — hard revoke after verified CAS (20 October 2026)

This is a frontend repair based on `fe5e67b24485862025c8032054a78085b2c0225b`,
which inherits the independently reviewed History PR243, H4 PR244 and cleanup PR245. The first
61-case run was pinned at `e2b611ca7fb560c4bf204d70a59e3b80f85a3c8b` onfb14;
that tested pin remains preserved.
After verified CAS/pin adoption, the core returns a local committed receipt and
zeroizes the old VK. Self-revoke wipes/locks both vault objects. The productive
caller adopts/self-locks before DELETE/GET, resolves the rotation form, and keeps
a fixed DE/EN partial-completion banner accessible while locked. Reconciliation
repeats only metadata; an acknowledged DELETE leaves GET only. Pending callbacks
cannot revive cleared account state or reopen a changed/locked vault context.

## Verification

- The unchanged final core regression suite on an exported baseline engine:
  **3 red / 5 green**. The new self-revoke property fails at metadata 503 after
  successful CAS; two other failures expose the old combined commit/DELETE API.
- Original tested candidate: **61/61 across eight target files** (40.87s); the11 productive
  caller cases and8 hard-revoke core cases are subsets, not additional tests.
  Details are recorded in `checks.json`. Core crypto/CAS/pin
  tests and productive coordinator tests are distinct proofs. Caller tests inject
  controlled receipts/transport; they do not prove crypto or authenticators.
- Rebase delta: HardRevoke function/contract and the other10 manifest files are
  byte-identical to the tested pin; engine outside this function equals newmain
  except its receipt type import. The baseline HardRevoke scope itself is also
  identical onfb14/ab7. **19/19** core/caller cases repeated on the rebased source
  (29.038s), with fresh typecheck/module-boundary passes. These are a subset of
  the61, not additional cases.
- The actual compiled rebased candidate in Chromium with a fresh private SQLite backend:
  **1/1 journey passed**. Other-device DELETE503 preserves the adopted VK2;
  subsequent DELETE success plus GET503 leaves a GET-only retry. Self-device
  DELETE503 preserves LOCKED state and the global DE/EN check action. Both
  retries produce no additional snapshot POST; master unlock still opens the
  surviving synthetic entry after VK3.
- The same journey on the compiled baseline is **red**: CAS200 followed by the
  injected DELETE503 leaves the old rotation form/input open. Candidate and
  baseline use separate new profiles and private ephemeral ports, never8788.
- Final typecheck/module boundaries pass; frontend lint exits0 with existing
  warnings. The skill-mentioned copy-language script is absent in this checkout;
  its attempted invocation was not counted as a pass. DE/EN was checked in the
  real journey and fixed source catalog.

Runtime/test digests are in `SHA256SUMS` (standard format, no secret-like JSON
path keys). Detailed logs, bounded runners, source export and backend receipts
remain in the private continuation folder `e03-p05-hard-revoke`.

The original audit had43 positive cases and two separate negative findings.
Those are historical evidence, not additional unique cases to add to the new
runs. The original HardRevoke probe deliberately asserted the old thrown-error
contract: it is preserved, not rewritten or claimed green for the new committed
receipt. History-refetch repair remains independently integrated PR243/pin3f49cc0.

After independent review on725fdef (SHIP:25/25 tests including19 repo and6
new independent cases;8 separate SSR renderer checks), a pure rebase inherits
main cleanup PR245. All11 runtime/test/UI manifest files are byte-identical to
that review pin; only inherited CI/native cleanup and both preserved status/
boundary sections differ. No rebuild is claimed for this unchanged runtime.
New CI/integration remain required.

## Boundaries

No crypto algorithm, KDF/default, dependency, backend, permission or grant changed.
DELETE is metadata-only; previous keys/backups remain useful for old snapshots.
Pending metadata intent exists only in memory, is cleared on sign-out/reload and
is not a durable task. Lost/unverified CAS responses are a separate unresolved
case. Local device-record cleanup and JS zeroization are best effort, not secure
erasure. No Tauri/WKWebView, hardware/PRF, installed package or real-user proof is
claimed. Recovery-key unlock must still offer a new master password/re-enrolment
under recovery§4; that existing requirement is a separate next slice. P05/E03
remain open. Independent review is complete on byte-identical source; final CI is required before integration.
