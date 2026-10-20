# P06/R08 — CSV record integrity before review

Base `6dd1ba89d557a9b860281a640cb9fabed5713985`, 20 October 2026.
Independent Root review and normal PR CI pending. No merge or release by author.
Executed source was preserved at `10aac00105f308ed7378264b0cbf159c8f4227a4`
on green `fe5e67b`. The rebase onto green main6dd1ba8 inherits the independently
reviewed Hard-Revoke slice; all four CSV source/test files and SHA256SUMS remain
byte-identical. The browser receipt below belongs to the preserved tested pin;
normal final PR CI checks the combined source.

The previous parser split physical lines before processing quotes. A synthetic
multiline password became two entries, exposing its remainder as a review title.
Unclosed quotes and incomplete records were accepted; whole-file trimming also
removed significant spaces from a final password field.

The existing quote parser now lives in the small sibling `csv-records.ts`,
used by the same CSV import path. One quote state spans logical records, keeps
quoted LF/CRLF and escaped quotes, and refuses malformed transitions. All
records must match the header's column count before classification. Empty
physical lines remain supported, as do BOM, trailing empty columns and EOF.
CSV field content is no longer passed through whole-file trimming. Errors are
fixed DE/EN `LineError` text, without field/header echo or a partial preview.

## Actual evidence

- 38 repository tests passed: 14 new CSV cases plus 24 existing import,
  classification and share cases. Five unchanged private CSV counterprobes
  also passed: 43 selected cases total. The separate file-size case remains
  open and is explicitly excluded. No large input or OOM experiment was run.
- The first test selection's negative name pattern did not exclude that known
  file-size case: 43 passed/1 known residual failed. The corrected explicit
  skip selected the intended 43/43; original output is retained and is not
  presented as an all-green run.
- Frontend typecheck passed. Existing JSON, provider, 1Password, Bitwarden,
  KeePass, plaintext warning and encrypted-share contracts remain covered by
  their existing tests. No dependency, crypto or backend change.
- Actual compiled-candidate Chromium/private SQLite journey: 2/2 passed,
  24.472s, peak owned RSS1421352KiB under1536MiB; CPU120s/process and150s wall.
  Four DE/EN malformed-file dialogs echo no secret, yield no partial review and
  issue no snapshot write. Valid quoted CRLF/escaped quotes yield two review
  rows, one confirmed commit, and survive Lock/Unlock; password end spaces are
  retained. The ordinary existing import-review case also passes.
- This browser used a fresh owned profile/data directory and ephemeral61625,
  never8788. Listener ownership was checked before HTTP, foreign browser
  origins blocked, service workers disabled, no API/AppContext stub. Both own
  processes terminated. This is browser/local-profile evidence, not native
  browser-password extraction, an OS file picker or installed-package approval.

Private immutable original probes/red logs remain under
`p06-bounded-inventory-5152a64/`. Their byte-identical copies bind this candidate
through private source aliases; `p06-csv-record-fix/` retains scoped test logs,
browser build/source fingerprints, actual journey and process receipts.
The adjacent SHA256SUMS binds the executed source/tests.

## Remaining scope

Client import/share file-byte limits have no new numerical policy in this
slice. Native profile/symlink/copy/cleanup and broader P06 format/operational
acceptance stay separately tracked. Strict column consistency deliberately
refuses incomplete exports rather than guessing the intended secret boundary.
