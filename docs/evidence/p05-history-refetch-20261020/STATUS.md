# P05/R06 — historical recovery confirmation integrity

20 October 2026. Base f638540869c1323bdeae8f50be115ee1007fffc6.
Author: plan_contract_matrix. Independent review, PR CI and integration pending.
Rebased onto green main fb14e34443da421032331d537605d5b6d5abfd2c after its
separate normal-native-probe merge. All three executed source/test files remain
byte-identical to the tested c840f974066a0d25eb6c5076887107ed7262d6ec candidate.
This is one caller repair within the existing plan, not full P05 acceptance.

## Problem and resulting behavior

A real synthetic actual-source counterexample first verified a historical
revision, then corrupted its recovery envelope in the confirmation refetch.
The previous caller unwrapped only master, copied the changed envelopes and
sealed a new valid manifest around them; the original kit could no longer open
the newly blessed recovery envelope. No AEAD primitive was broken and no
plaintext/key exfiltration was demonstrated.

The local selection now binds expected vault/revision/VK generation and the
digest of the manifest that actually verified. Confirmation compares the
refetched selection, repeats historic manifest and complete content verification,
and reuses exactly the verifier's normalized envelopes/entries for a forward
CAS commit. An old manifest with changed records, missing/changed manifest or
changed requested revision is refused before a write. Historic reads and failed
checks never write the pin/cache; successful forward commit retains the existing
late pin commit. A temporary recovered key is wiped on a failed restore.

The extracted historic-snapshot.ts is a small sibling helper shared by normal
history viewing, search and confirmation; no crypto algorithm/default, backend
write policy, dependency or permission changed. ADR015 step2's existing rule is
clarified. A local selection is no server authorization or identity proof.
Manifestless legacy history retains its per-entry checks and explicitly has no
complete authenticated record-set commitment. Previously selected sealed history
cannot silently become manifestless at confirmation.

## Executed evidence (counts are overlapping scopes)

- Before the repair: the existing six-file crypto/frontend selection passed43
  cases. The two new independent probes were red, one historic confirmation and
  one separate postcommit hard-revoke failure. They are not counted as accepted.
- The expanded head-recovery file on the old runtime:13 cases,7red/6green.
  After repair:13/13green. It covers changed envelopes/entries, missing/changed
  manifest, a valid signed fork, wrong requested revision, legacy forward restore
  and CAS conflict with unchanged pin.
- Final six-file targeted selection:52/52green, including that13-case file.
  This is not43+13 independent accepted cases. Serial process CPU120s, wall120s,
  monitored owned RSS768MiB limit;41.492s, peak260772KiB. No limit hit.
- The original independent historic-confirmation probe source was not changed;
  selected by its test name:1/1green. The hard-revoke probe is separate and was
  not represented as fixed or passed by this slice.
- Frontend workspace typecheck and module-boundary check pass. An initial
  typecheck identified two local type-narrowing issues, corrected before the
  final targeted run; no failing final check is hidden.
- Actual compiled-candidate Chromium user journey:1/1green. Private new SQLite
  local profile on ephemeral loopback60044, owner PID verified before HTTP,
  never8788. Synthetic vault/entry → token-only poisoned head → failed unlock →
  explicit search → separate confirmation → entry present again. A private
  fixture blocks foreign browser requests. Browser and backend terminated.
 20.364s, monitored owned RSS1495356KiB under1536MiB, CPU120s/process and150s wall.
  This is a browser/local-profile check, not Tauri, hardware or installed package.

Private receipts remain in the authorized continuation folder under
e03-p05-recovery-audit/: baseline-probe-observations.json, negative-probes.mts,
head-regressions-red.log, head-regressions-green.log,
history-all-targets-green.log/run.json, history-original-counterprobe-green.log,
history-typecheck-final.log, history-browser-build.log,
history-browser-journey.log and history-browser-result.json.
The first private tsx CLI attempt failed before tests on a too-long macOS Unix
socket path; the actual tests use the existing installed loader directly.
One first private build config had a wrong path and failed before bundling; the
corrected build succeeded. Neither setup failure is treated as a product result.
Full source fingerprints are standard SHA256SUMS, not secret-like JSON fields.

## Remaining boundaries

Hard-revoke postcommit metadata/refresh failure needs its own coordinated repair.
A kit unlock still lacks a same-vault new-master offer after master loss; that
user flow is a separate decision. Real kit print/download, native recovery,
second/foreign devices, PRF, installed package, Postgres/durability and paid
notarization/audit remain separate. Stolen account sessions can still write
opaque garbage; this caller repair does not add signed writes or erase old copies.
