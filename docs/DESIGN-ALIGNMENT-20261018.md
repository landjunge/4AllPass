# FP-D01 — existing design PRs reconciled with current source

Base: main `82bf0f8` plus protected-access source commit `7f01e66`.
This is source/UI work, no native build, release, vault migration or new icon.

## Existing PRs

- #216 `chore/shared-desktop`, head `2f37914`, based on `fix/audit-toolchain`:
  the portable np CSS and adapter are reusable. Current App/main are changed
  narrowly; no old source tree is copied wholesale over AP4/LICENSE/start fixes.
  Shared `networkpunkt.css` remains exact blob
  `673f4e265c8c46618ba86d9e98f8da09fd0bf107` (SHA256
  `98371bd9edc96fb940a0e0de34933740fed1062b510aa516498fcb53e112591e`).
- The old blanket `body min-width:1180px`, globally hidden scrollbars and removal
  of existing <=820px and coarse-pointer rules are not adopted. Existing 4AllPass
  human-first narrow/touch behavior is preserved. Shared roles do not require a
  global product layout rewrite. No new global mobile stacking is invented.
- #217 `fix/audit-toolchain`, head `4ea9174`: current main already incorporates
  scoped audit repairs from release work; remaining delta is brace-expansion
  5.0.9→5.0.12, nested 2.1.4→2.1.7 and fast-uri 3.1.7→3.1.8. No dependency or
  lockfile change is needed for this UI slice. Do not merge this historical base
  wholesale over current build pins.
- #220 `docs/approved-design-kit-20261018`, head `8287746`: additional ZIP archive
  and README, not a missing AP4 integration. Existing approved originals/hashes,
  13 sizes per theme, native assets and release proofs stay intact. Archive not
  required by runtime and is not silently substituted for current AP4 sources.

AGENTS/root DESIGN no longer instruct current work to use the old blue/gold or
magpie motif. Product chrome uses existing shared 12/14/16/24px type roles,
40px controls/44px touch, grey surfaces and visible keyboard focus. 4AllPass AP4
remains its identity. The API-entry choice also names the actual blocked AI-access state in DE/EN.
The protected-access blocked state remains DE/EN and has no
new Allow or raw-material route.

## Acceptance

Targeted frontend typecheck and affected UI acceptance use synthetic local vaults
only. Final evidence: docs/evidence/design-alignment-20261018. Source, installed
runtime and unchanged public v0.1.2-rc.2 packages are distinct. The original
PR216 evidence remains historical and is not counted as a fresh test.

Actual checks: frontend typecheck passed. Real Chrome on the isolated synthetic
local vault passed shared 14px body role, AP4 header reference, EN/DE blocked
access, 640px no forced-wide overflow, existing single-column narrow vault,
1440px desktop two-region vault, keyboard-generated visible focus and >=40px
control, reload/unlock and 150% zoom with reduced motion. No JS page errors.
Screenshots inspected at real browser sizes. This is not native-platform,
fresh-install, complete import/autofill/recovery or production secret acceptance.

Reusable Playwright case `frontend/e2e/local/shared-desktop.spec.ts`: 1 passed
(16.1s) against the isolated Vite/local API. No broad existing suite repeated.
