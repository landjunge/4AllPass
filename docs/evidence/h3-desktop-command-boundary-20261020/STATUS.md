# E04 / H3 — own commands bound to their windows

20 October2026. Source slice; independent Codex review **ship**, integration pending. No package,
normal fixed-port startup, hardware, PRF or full E04 acceptance is claimed.

The old Tauri build omitted an own-command AppManifest, so plugin capabilities
did not restrict the nine registered app commands. `access-prompt` also shared
main's plugin rights. The source now uses a single command contract for both
AppManifest generation and real handler registration. Main has eight own
commands, prompt only access_decide, other local windows none. Capabilities are
explicitly selected. CSP and entitlements are unchanged; H2/H4 remain open.

The separate opt-in native binary enters before, and instead of, all normal
sidecar/tray setup. It uses actual WKWebViews, the actual shipped prompt page/JS,
the same own-command handler and compiled ACL, a private bundled dist, Incognito
and a fresh empty browser fixture. Missing arguments distinguish permitted
handler argument dispatch from ACL denial before any HTTP/import/open action.
No command handler is replaced with a fake/noop. The real prompt Deny button
also invokes access_decide and Rust receives the synthetic decision.

## Executed checks

| Check | Result |
| --- | --- |
| Native candidate, main/prompt/untrusted contexts | 33/33 ACL/dispatch rows, actual prompt decision event, empty fixture; exit0 |
| Private original-policy negative control, identical probe | 20/33 rows fail as expected; oracle false, explicit exit1 |
| Frontend regression suite on E05-main71c5be49 | 226 pass (initial H3 base:202; H1/R05:206; Pin-main:215) |
| Frontend typecheck before/after all main rebases | pass |
| Ordinary Rust feature build without native-acl-probe + synthetic unit tests | 34 pass, including real SQLite/decryption fixture and ACL contract |

macOS15.7.4 x86_64, Xcode16.0, rustc/cargo1.98.1; existing locked
Tauri2.11.5, tauri-build2.6.3, Wry0.55.1. No dependency/lockfile change.
First native dependency build used two jobs and took8m25; subsequent runs reuse
only this worktree's target cache. The test feature intentionally leaves normal
setup helpers unused (dead-code/import warnings); ordinary-feature checks are
separate. No broad source lint suppression was added.

During harness development the macOS event-loop result could return0 despite
an oracle=false receipt after the last window was destroyed. The final harness
uses its own explicit atomic verdict after run_return, and the runner requires
both the JSON oracle and matching process exit. The final negative control
therefore exits1; earlier diagnostic receipts are not the final negative proof.
All probe windows/processes exit; private dist/browser fixture data is removed.
Production port8788, existing apps, databases, browser profiles, credentials,
autostart entries, grants, entitlements and tunnels are not touched.

The negative control is a disposable non-Git source copy. It restores only the
original absent AppManifest/shared prompt capability, retaining the same real
handlers and isolated fixture safety. Product source is never weakened for it.
The checked-in candidate and negative JSON outcomes contain only synthetic IDs,
command names, origins and Tauri errors; no vault/account secrets.

## Reproduce / limits

See [command boundary](../../desktop-command-boundary.md) for exact commands,
window matrix, safe native setup and compatibility limits. The native main
matrix proves API/import/open handlers remain reachable through ACL. It does
not send HTTP, open a real browser or perform a user-data import. Existing native
SQLite/decryption fixtures and frontend startup/unlock/import tests supply the
separate regression evidence. Normal installed-app/sidecar startup on8788 and
full end-to-end human flows remain E04/AP03 acceptance work.

## Independent acceptance and source identity

Codex root, separate from author plan_contract_matrix, reviewed code pin
`f633a6fe1375d562bdfd464bec5e1166fca5bd24`: **ship**. Root independently
built and ran the actual native WKWebView probe:33/33 expected ACL outcomes,
real prompt Deny→Rust, exit0, empty fixture/Incognito/no normal setup. Root
checked all23 then-recorded Rust/ACL/config digests against the files.
`independent-review.json` records the exact narrow acceptance and limits.

H3 was rebased from45331a3 onto H1/R05-main a65ab122 after its native checks;
every recorded native/runtime/ACL/prompt source digest remained identical.
No native-source or permission changes were made after the independent review.

Final branch base: E05-main `71c5be494ac40a04de9164dec3cd0ec1ca80c884`.
`git diff --exit-code f633a6fe -- src-tauri scripts/test-native-command-acl.py
frontend/public/access-prompt.html frontend/public/access-prompt.js` passes: the
entire native/ACL/probe tree is byte-identical to the independently reviewed
pin. Only evidence/ROADMAP integration changed after that review. The latest
frontend suite226/226 and typecheck were rerun on this base.

## Evidence secret-scan correction

Gitleaks8.24.3 flagged five JSON source-digest assignments as generic API keys.
Each complete value was verified against its named Git source file. The own PR
history now retains all full digests in standard `SHA256SUMS`; JSON refers to
that file. No scan rule or exclusion changed. A fresh scan of the entire own PR
history (first-parent/no-merges) reports zero findings, exit0. Original refs and
a source bundle are retained privately. The native/runtime/probe bytes remain
identical to the independently reviewed pin.
