# E04 / P07 autofill and extension · P08 desktop IPC, CSP and sidecar

Base: `7f2d107cb9298574c7c0fac26dbe049562f67630` (after P06, #267). Environment as
in `../e03-p00-p01-20261110/STATUS.md`. No code change in either section; this
file records what was checked. Plan source and status: ThreadDesk.

## P07 — partly checked (real-browser runs blocked)

Read: `extension/src/background.ts`, `match.ts`, `fill.ts`, `content.ts`,
`tab-target.ts`, `idle-lock.ts`, `manifest.json`.

- Host match uses `URL.hostname` (userinfo and IDN tricks resolve to the real
  host); suffix match needs ≥2 labels and is refused for shared tenant parents
  (`github.io`, `vercel.app`, …); HTTP pages only on loopback or for an entry
  stored as HTTP.
- Tab binding: the matched origin is re-checked against the live tab and the
  probe right before sending; the content script refuses again when
  `expectedOrigin !== location.origin`, so a navigation in between fills nothing.
- Content script runs in the top frame only (no `all_frames`); privileged
  messages from a content-script sender are refused.
- No form submit or click after filling; no `console` logging in `src`.
- Vault key lives only in service-worker memory; idle lock uses
  `chrome.alarms` (5 min), so a worker restart cannot keep a key alive.
- Remaining limit (documented): the page can read the filled field values.

Blocked: the autofill e2e (`e2e/extension/*.spec.ts`) launches a headed
browser (`headless: false`); foreign-origin and tab-switch runs in a real
browser need a visible window.

## P08 — partly checked (native probes blocked)

Read: `src-tauri/tauri.conf.json`, `capabilities/*.json`, `command_contract.rs`,
`sidecar_http.rs`, `core_bind.rs`, `process_inspect.rs`; H2–H4 evidence of
20 Oct 2026.

- CSP: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`,
  `connect-src` only self, IPC and exactly `http://127.0.0.1:8788`; no remote
  capability URLs. `main` gets its listed own commands; `access-prompt` only
  `access_decide`; other windows none.
- Sidecar bind refuses a foreign listener on the port; loopback process
  inspection parsers; sidecar HTTP normalizes the target and refuses redirects.

Blocked: the native ACL / network / normal-journey probes
(`scripts/test-native-*.py`) open real WKWebView windows; tray, sleep and lock
behaviour of the running app need a person at the Mac.

## Test runs

| Command | Result |
|---|---|
| extension `npm test` | 78/78 (main after #264) |
| `cargo test --lib` (desktop crate, incl. sidecar HTTP tests) | 49/49 |
| `rustc --test` `core_bind.rs` / `process_inspect.rs` / `secret_fs.rs` (as CI) | 13/13, 8/8, 7/7 |
| `scripts/test_macos_runtime_policy.py` | 8/8 |
| frontend desktop and clipboard unit tests | pass (part of 265/265) |
