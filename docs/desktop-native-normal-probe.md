# Private native normal-startup probe

This opt-in macOS source test uses the real bundled frontend, native IPC,
packaged same-source Python sidecar, private SQLite and the ordinary `run()`
setup, child/descendant ownership check, tray/sleep initialization and exit
cleanup. It adds no product API, crypto operation, capability or dependency.
It does not install or publish an app.

The current supported fresh **desktop** path is account signup through the
existing UI, then Create → recovery-kit download/acknowledgement → manual Lock
→ master-password Unlock → synthetic CSV preview/confirm → Lock/Unlock and
two decrypted titles. Account and vault passwords differ. The browser-local
silent bootstrap is a separate profile; this test does not switch it on in
the desktop or inject account/app context. See [desktop](desktop.md) and
[security boundary](security-boundary.md).

## Run privately

Prepare a **new private** Python3.12 venv with `backend/requirements.txt` and
`pip install --require-hashes -r backend/requirements-sidecar.txt`. Do not
modify an existing test or product environment. Existing locked npm dependencies
must already be installed. Then:

```sh
python3.12 scripts/test-native-normal-journey.py \
  --output /absolute/private/evidence-directory \
  --build-python /absolute/private/buildvenv/bin/python
```

The runner builds UI, sidecar and a separate debug-only binary. Sidecar reuse
requires matching backend/dist input hashes and binary hash. A fresh task
directory and database are created for each run. HOME and CODEX_HOME stay
unchanged. Private receipts contain command **names/counts**, status, synthetic
titles/counts, hashes and PIDs, never passwords, kit values, tokens or request
bodies. The actual downloaded kit and generated runtime keys remain private
test artifacts. Do not upload the entire task directory.

## Safety and proof boundaries

- The feature `native-normal-journey-probe` is not default, rejects release
  builds and cannot combine with `native-acl-probe`. Calling normal `run()`
  with the feature but without fixture initialization refuses immediately.
- Browser discovery roots are initialized to a fresh empty fixture **before**
  UI execution. Neither the real browser home nor `/Applications` is scanned.
  Browser password import/launch/extension commands are excluded from this
  driver. No Keychain, clipboard, grant or autostart preference action is used.
- A separate app identifier and incognito WK store isolate the webview. The
  main window uses the original config/capabilities/bundled UI but is explicitly
  constructed after core ownership succeeds, to attach a private download
  destination and DOM driver. No real browser profile or remote origin is added.
- **Test-only safety restriction:** any occupied8788 is refused before spawn;
  the normal orphan/dev reaping branch is not exercised. The unchanged actual
  post-spawn child/descendant ownership check still runs. Only the tracked own
  child/group is cleaned up on ordinary exit. Never reap an unknown occupant.
- The recovery-kit Blob download uses the actual UI and WK download callback,
  confined to the fresh private task. It does not use Downloads, print or copy.
- A synthetic `File` is delivered to the real input via DOM `DataTransfer`;
  parsing, preview, encryption/save and subsequent decrypt are real. This is
  not a test of the macOS file-picker dialog.
- Incognito does not establish persistent WK pins or restart storage. This
  is a local synthetic journey, not a release/install, stranger-Mac, hardware
  PRF, recovery-key ceremony, browser-autofill or protected-executor acceptance.

DE: Der private Test nutzt den wirklichen Desktop-Erststart mit Kontoanlegen
und getrenntem Tresor-Passwort. Er liest keine persönlichen Browserprofile und
beweist weder eine installierte Version noch Passkey-/Autofill-Funktion.
