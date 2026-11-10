# E04 / P06 — import, sharing and export

Base: `800bf69ae1c861f6684ca822c665baf3fe4e73a5` (after E03, #266). Environment as
in `../e03-p00-p01-20261110/STATUS.md`. Plan source and status: ThreadDesk.

## Read

`src-tauri/src/browser_passwords.rs`, `firefox_logins.rs`, `secret_fs.rs`,
`browsers.rs` (profile containment); frontend `lib/import.ts`,
`lib/csv-records.ts`, `lib/import-classify.ts`, `components/vault/VaultImportReview.tsx`,
`modules/sharing`, `components/vault/VaultShareDialog.tsx`; `docs/sharing.md`.

## Finding fixed (reproduced, test fails when the fix is reverted)

| ID | Prio | Precondition → effect | Fix | Test |
|---|---|---|---|---|
| E04-P06-1 | C | Firefox import: `key4.db` was copied to the owner-only temp dir, then the `logins.json` copy failed (unreadable file, I/O error) and the early `?` skipped the removal. The copy of the key store stayed in the temp dir. The Chromium path had the same shape for a failed `Login Data` copy. | `secret_fs::with_secret_temp_dir` removes the dir on every exit; both importers use it; a failed `chmod 0700` also removes the dir | `firefox_logins::failed_second_copy_leaves_no_key_store_copy` (fails on the original code), `secret_fs::temp_dir_is_removed_when_work_fails_midway` (CI `Desktop unit guards`) |

## Checked, no fault

- Source profile is read only through copies; the copy, not the profile, is
  opened by SQLite. Profile ids are contained in the browser's data dir.
- Import review lists titles/usernames, never passwords ("No passwords in this
  list"); CSV refuses malformed or ragged files whole (E02 P06 evidence).
- Share: a new random VK per share file, sealed manifest, recovery envelope
  under the share key; the UI never claims a share can be recalled and
  `docs/sharing.md` states it cannot.

## Hardening needs (not changed)

- `secret_temp_dir` uses a predictable name with `create_dir_all`, which
  accepts an existing dir. Harmless in the per-user macOS temp dir; on a
  shared Linux `/tmp` (Firefox import) prefer an exclusive create. C.
- Share import decrypts wire entries, not the verified copies (from E03 P01). C.
- WAL side files are still copied (needed for current data); safe since
  RUSTSEC-2026-0459 was fixed (#263).

## Blocked

Native import from a real browser profile in the running desktop app needs a
visible window and a macOS Keychain prompt answered by a person.

## Test runs

| Command | Result |
|---|---|
| `cargo test --lib` (desktop crate) | 49/49 |
| `rustc --test src-tauri/src/secret_fs.rs` (as CI) | 7/7 |
| new Firefox test against the original code | fails: key-store copy survived |
| Playwright `playwright.local.config.ts` (temp data dirs): `import-review` ×2, `restore-share` | 3/3 |
| same: `browser-cards-import` | fails in this environment: the spec expects the German heading but the UI follows `navigator.languages` (en-US headless); with `de-DE` its English-only helper times out. Spec defect, not a product fault; not in CI. C |
