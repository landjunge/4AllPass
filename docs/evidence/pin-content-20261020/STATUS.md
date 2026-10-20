# E03 / P01 — commit the pin after successful content opening

Tested implementation base: `f547b3bcc1c9ed02e37da08274d3f7fe7b0ce5dd` (PR #232).
Final integration base: `a65ab122731d9b7a1055de4bc2d290df45cd9de7` (PR #233).
The implementation commit is the commit containing this evidence directory.
Author: native Codex `td_e02_inventory`; independent review is assigned to Root.
Daniel explicitly authorized native continuation after Grok quota exhaustion;
no Grok review is claimed. PR/CI and integration remain separate gates.

## Failure and resulting behavior

`openSnapshot` saved the revision/digest before entry verification, plaintext
JSON decoding and sorting. A failed higher snapshot could move the local pin,
causing the earlier honest snapshot to be refused as a rollback.

The manifest branch now prepares its pin from the exact verified manifest
result and continues using that result's entry/envelope copies. The legacy
branch prepares its existing revision tuple. Both save only after the complete
entry pass, decode and sort succeed, with a final check against the current
local pin before returning the opened vault. No crypto primitive, dependency,
wire format or key derivation changed.

## Checks

The nine synthetic regression cases were first run against the unchanged base:
three passed and six failed. The six failures cover both manifestless snapshots
and valid sealed manifests whose content later fails AEAD, JSON decoding or
sorting. After the fix, the same nine behaviors pass: failed opens leave the
old pin unchanged, the earlier honest state still opens, valid higher states
advance the exact revision/digest, real rollback remains denied, and a missing
manifest after a digest pin remains an integrity failure.

The complete frontend workspace passes **215/215**, with no failures or skips;
this includes the nine new regressions. Frontend typecheck also passes.
`checks.json` records final commands and results; `SHA256SUMS` pins source bytes.
Tests replace the API and browser storage with synthetic fixtures. No real
account, vault, user profile, installed app, service or release was used.

The final rebase retains byte-identical `vault-session.ts` and regression tests
from tested commit `cb206b0`. Only the roadmap required conflict resolution;
source hashes below bind the combined documentation. The full suite was not
repeated for this unchanged runtime; final combined CI remains a separate gate.

## Limits

Manifestless legacy revision numbers remain server-asserted. This fix prevents
a failed open from advancing a pin; it does not add universal rollback protection
for legacy data or atomic pin compare-and-set across browser tabs. Historical
reads still do not move pins, and offline cache persistence still follows
successful opening and remains best-effort. Existing frontend regressions
exercise those paths; no new native/browser/hardware acceptance is claimed.

Root's independent review and final CI remain pending. This source slice does
not complete P01, E03, AP04, package/release acceptance or deployment.
