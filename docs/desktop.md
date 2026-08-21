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

Downloads: [GitHub Releases](https://github.com/landjunge/4AllPass/releases) (tag `v*` → CI attaches DMG / NSIS / AppImage as a **prerelease**). Ad-hoc signed, not notarized — first open via right-click → Open. Not SmartScreen. Not a store listing. Local Intel DMG: `src-tauri/target/release/bundle/dmg/`.

`npm run app` builds `frontend/dist` if missing, then `python -m app.local`.
The SQLite file holds opaque envelopes. `session.secret` is account-auth only.

If port 8788 is taken: the process exits with “4AllPass läuft schon / already running.”

First run (local profile): Welcome → **Tresor anlegen** or **Ich habe einen Tresor**.
Create: Tresor-Passwort → Recovery-Kit. Restore: `4allpass-share-v1` file + share
key → new vault password → **new** recovery key (the share key is not that key).
A recovery key without the share file cannot rebuild the blobs. No e-mail, no
account password. `POST /api/v1/auth/local` is storage auth only.

Proof (Playwright, no Vite): `npm run test:e2e:local -w @4allpass/frontend` —
Welcome → vault → Access Allow; UI never shows the secret; a Node-like
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

That is not a PRF ceremony. Unlock with the vault password. The Welcome screen says so. No second wrap protocol.

## Sidecar

`tauri dev` starts `npm run app:sidecar` (one Python process on `:8788` — UI, API, access relay) and loads that origin.
If 8788 is already up, the Rust shell does not spawn a second core. Quit kills
the core it started. Close on the window **hides** to the tray; Quit in the tray exits.

Launch at login is **off** until you enable it under Settings. macOS Launch Agent
with `--hidden` (menu bar). That does **not** unlock the vault and does **not**
auto-allow access. Password still required. Browser / `npm run app` has no login
item.

macOS **screen lock** and **sleep** lock the vault (same Lock button). Not
FileVault. Windows/Linux do not send that event yet.

An access request from n8n raises the main window, a desktop notification, and a
small always-on-top prompt (application / provider / scope / TTL — **not** the
secret). Allow / Deny in that prompt talks back to the unlocked UI over Tauri
events; the sidecar still does not decrypt. The browser / Playwright path keeps
the in-app overlay. `FOURALLPASS_BROKER_TOKEN` is in `broker.token` under the
data dir and on `GET /api/v1/local/broker` after local storage auth.

```sh
FOURALLPASS_BROKER_TOKEN=$(cat ~/Library/Application\ Support/4AllPass/broker.token) \
  FOURALLPASS_BROKER_URL=http://127.0.0.1:8788 \
  npm run access:demo
```

Node agents should use `@4allpass/access` (`fourAllPass.request`). Loopback only; no `Origin`.
n8n: Access tab → HTTP Request recipe (POST JSON). Not a marketplace node. n8n-in-Docker uses
`host.docker.internal`; the broker stays on the host.

## What this is not

- Not FastAPI token minting.
- Not a rewrite of `packages/crypto`.
- Not a n8n marketplace node.
