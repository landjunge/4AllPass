# Desktop own-command boundary (E04 / H3)

Tauri2.11.5 / tauri-build2.6.3. This is a window permission boundary, not an
unlocked-user proof, OS sandbox, hardware proof or new package approval.
CSP (H2), macOS entitlements (H4), production host isolation and prompt request-ID
binding remain separate work. The ordinary sidecar/tray/startup code is unchanged.
The separate [H2 local network slice](desktop-network-boundary.md) extends this
same isolated binary only when explicitly selected; plain H3 stays socket-free.

`src-tauri/src/command_contract.rs` supplies both the build AppManifest command
names and the actual runtime handler registration. All nine own commands are
subject to Tauri ACL in ordinary builds, without the native test feature.
The capability identifiers are explicitly selected, so additional files are not
silently enabled. Existing main plugin permissions are retained. The prompt has
only `allow-access-decide`; the shipped prompt uses no JS event/autostart/import
or sidecar APIs. Rust emitting a decision does not need JS event permission.

| Own command | main | access-prompt | Any other local window |
| --- | --- | --- | --- |
| access_prompt | allow | deny | deny |
| access_decide | deny | allow | deny |
| access_dismiss | allow | deny | deny |
| sidecar_http | allow | deny | deny |
| list_browser_profiles | allow | deny | deny |
| extension_install | allow | deny | deny |
| open_browser_for_extension | allow | deny | deny |
| open_autofill_demo | allow | deny | deny |
| import_browser_logins | allow | deny | deny |

No remote capability is configured. This does not narrow the main window to
locked/unlocked states; it remains the privileged human app context. Do not call
this a device identity or hostile-process isolation boundary.

## Real native verification, without production startup

On macOS, run:

```sh
python3 scripts/test-native-command-acl.py --check-product --output /private/path/h3-evidence
```

The script builds the opt-in `fourallpass-acl-probe` binary with the existing
locked dependencies and a private bundled dist. It copies the actual shipped
access-prompt.html/js; it does not call the normal executable, app setup,
sidecar, tray, port checks or process reaping. It creates three real WKWebViews
with main/access-prompt/untrusted labels and `incognito(true)` (nonpersistent
WKWebsiteDataStore). Test-only browser discovery resolves into a fresh empty
private directory. No real browser profiles, keychain, DB or network are used.
The feature refuses the ordinary `run()` entry and is rejected for release builds. It is off in normal builds;
`default-run=fourallpass` preserves ordinary CLI selection.

The probe invokes the shared list of nine actual registered commands from each
window. Missing arguments prove permitted handler argument dispatch before any
HTTP/import/browser-open action. ACL-denied and argument-validation errors are
distinguished; command-not-found does not count. The no-argument listing reads
only the empty fixture; dismissal only affects these test windows. Two builtin
JS event commands also prove prompt/untrusted denial and main dispatch. Finally
the actual prompt's Deny click emits the synthetic decision, captured by Rust.
No fake invoke handler or mockIPC substitutes for Tauri permission checks.

Rust reads asynchronous JS results via eval_with_callback, enforces a deadline,
records all outcomes, destroys the probe windows and exits. The script checks
both explicit exit status and receipt.passed, removes its private dist/profile data and
retains only private logs/receipts. For a negative control, run the same command with `--open-baseline` instead of
`--check-product`, using another private output directory. It builds a disposable
source copy with the original absent AppManifest/shared prompt capability. The
same real handlers and fixture safety remain in place; only the old policy is
restored in that private copy. The oracle must fail, with exit1. No product
source, existing worktree or installed app is weakened for this comparison.
Neither the native harness nor production permissions add a test IPC command. No plugins or dependencies are added.

## Compatibility evidence and limits

The native matrix checks that main reaches the real API/import/open/prompt
handlers, rather than being blocked by the new ACL. Existing Rust unit fixtures
exercise import decryption/SQLite and process identity classification using
synthetic input. Frontend tests cover desktop startup routing, cached unlock
and import parsing. These are separately identified regression checks; they are
not an installed-package launch, an actual browser-profile import or a real
hardware ceremony. Normal start on this machine would inspect fixed port8788;
this isolated test deliberately does not enter that path. Full E04 normal-use
and package acceptance remain open.

Evidence and actual run results: [H3 status](evidence/h3-desktop-command-boundary-20261020/STATUS.md).
