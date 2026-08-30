# Desktop (Tauri) + local core

**Product surface:** a native window on `http://127.0.0.1:8788`. Not a browser tab. Not Electron.

```sh
npm run app                 # one process: UI + API + access relay, opens a window
npm run tauri:dev           # same origin, Tauri frame, tray
npm run tauri:build         # this Mac: 4AllPass.app + DMG
npm run tauri:build:windows # Windows NSIS (run on Windows)
npm run tauri:build:linux   # AppImage (run on Linux)
```

Sidecar: `npm run sidecar` → `scripts/package-sidecar.py` (PyInstaller **on that OS**, no cross-compile).

| OS | Artefakt | Data dir |
|---|---|---|
| macOS | `4AllPass.dmg` | `~/Library/Application Support/4AllPass/` |
| Windows | `4AllPass-Setup.exe` (NSIS, current user) | `%APPDATA%\4AllPass\` |
| Linux | `.AppImage` | `~/.local/share/4allpass/` |

Downloads: [GitHub Releases](https://github.com/landjunge/4AllPass/releases) (tag `v*` → CI attaches DMG / NSIS / AppImage as a **prerelease**). Ad-hoc until GitHub secrets in [`distribution.md`](distribution.md) are set; then CI notarizes macOS and Authenticode-signs Windows. Not a store listing. Local Intel DMG: `src-tauri/target/release/bundle/dmg/`.

`npm run app` builds `frontend/dist` if missing, then `python -m app.local`.
The SQLite file holds opaque envelopes. `session.secret` is account-auth only.

If port 8788 is taken by a **foreign** process: the window exits with “127.0.0.1:8788 is already bound… refusing to treat it as 4AllPass” (no SIGABRT). The same refuse applies if something else binds in the window after the free-port check and before our sidecar listens — TCP-up is not “that process is 4AllPass”; the listener must be the child we spawned (or a descendant). A leftover `fourallpass-core` after a crash is killed, then a new core is spawned. A living 4AllPass instance prints “4AllPass läuft schon / already running.” Dock / `open -a` re-shows the window (`RunEvent::Reopen`). The webview never navigates to whoever holds `:8788`.

First run:

- **Desktop window (Tauri):** Auth first (Konto anlegen). `__TAURI_INTERNALS__`
  skips silent `/auth/local`. Then Tresor-Passwort or **Ich habe einen Tresor**.
- **Browser on this origin** (`npm run app` without the shell): silent
  `POST /api/v1/auth/local` (storage session only, address not shown), then
  Create vault.

There is no Welcome screen. Create: Tresor-Passwort → Recovery-Kit. Restore:
`4allpass-share-v1` file + share key → new vault password → **new** recovery key
(the share key is not that key). A recovery key without the share file cannot
rebuild the blobs. Account password still cannot unwrap the Vault Key when it is not also the vault password.

Proof (Playwright, no Vite): `npm run test:e2e:local -w @4allpass/frontend` —
Create or Unlock → vault → Access Allow; UI never shows the secret; a Node-like
`POST /v1/access/request` (no Origin) gets `approved` after Allow.

## Origins

| How | Origin |
|---|---|
| Local app / Tauri | `http://127.0.0.1:8788` (UI + `/api/v1`) |
| Frontend hack (`npm run dev`) | Vite `:5173` proxying `/api` |
| Server / Docker | nginx `:8080` + FastAPI `:8000` |

WebAuthn `rpId` is the hostname (`127.0.0.1` on the local origin). `localhost` and `127.0.0.1` are accepted as the same loopback deployment (`webauthn_cose.py`).

## WebAuthn PRF

Measured in this app’s WKWebView (`GET /api/v1/local/webview-caps`):

| Probe | Result |
|---|---|
| `PublicKeyCredential` | true |
| `credentials.create` | true |
| platform authenticator (UVPAA) | **false** |
| `prf` extension | **null** (not reported) |

That is not a PRF ceremony. Unlock with the vault password. Create/Unlock copy says so. No second wrap protocol.

## Sidecar

`tauri dev` starts `npm run app:sidecar` (one Python process on `:8788` — UI, API, access relay) and loads that origin.
If 8788 is already up, the Rust shell does not spawn a second core. Quit kills
the core it started. Close on the window **hides** to the tray; Quit in the tray exits.

Launch at login is **off** until you enable it under Settings. macOS Launch Agent
with `--hidden` (menu bar). That does **not** unlock the vault and does **not**
auto-allow access. Password still required. Browser / `npm run app` has no login
item.

The vault stays open until **you press Lock**. Sleep (Ruhemodus), screen lock,
tray hide, idle, and switching to the browser do not. A wall-clock stall plus
macOS sleep notify used to auto-lock; App Nap made that fire while Chrome was
in front. Not FileVault. RAM can still hold VK across sleep.

An access request from n8n raises the main window, a desktop notification, and a
small always-on-top prompt (application / provider / scope / TTL — **not** the
secret). Allow / Deny in that prompt talks back to the unlocked UI over Tauri
events; the sidecar still does not decrypt. The browser / Playwright path keeps
the in-app overlay. `FOURALLPASS_BROKER_TOKEN` is in `broker.token` under the
data dir and on `GET /api/v1/local/broker` after e-mail storage auth **and** a vault with an active snapshot (not `local@`, not a throwaway register, not an empty `POST /vaults`).

```sh
FOURALLPASS_BROKER_TOKEN=$(cat ~/Library/Application\ Support/4AllPass/broker.token) \
  FOURALLPASS_BROKER_URL=http://127.0.0.1:8788 \
  npm run access:demo
```

Node agents should use `@4allpass/access` (`fourAllPass.request`). Loopback only; no `Origin`.
n8n: Access tab → HTTP Request recipe (POST JSON). Not a marketplace node. n8n-in-Docker uses
`host.docker.internal`; the broker stays on the host.

## Linux `glib` advisory (GHSA-wrw7-89jp-8q8g)

Dependabot flags `glib` 0.18.5 (RUSTSEC-2024-0429): unsound `VariantStrIter` in the GTK3 Rust bindings.

**We cannot bump to 0.20** on Tauri 2. Linux webview is `wry 0.55 → webkit2gtk 2.0 → gtk 0.18 → glib 0.18`. glib 0.20 is the GTK4 line; that stack is a later Tauri / WebKitGTK 6 move, not this product.

4AllPass does not call `VariantStrIter`. macOS and Windows do not link `glib`. Linux-only, transitive, no vault crypto.

When Tauri 2 ships a GTK4 Linux webview, drop this note and take glib ≥ 0.20.

## What this is not

- Not FastAPI token minting.
- Not a rewrite of `packages/crypto`.
- Not a n8n marketplace node.
