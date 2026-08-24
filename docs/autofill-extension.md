# 4AllPass browser extensions

One source (`extension/src`). **Three installable packs** so every browser you tick can load an add-on:

| Pack | Browsers |
|---|---|
| `extension/dist/chromium` | Chrome, Chrome Canary, Brave, Edge, Arc, Vivaldi, Opera, Opera GX, Chromium |
| `extension/dist/firefox` | Firefox, Firefox Developer, Firefox Nightly (128+) |
| `extension/safari/` | macOS Safari 16.4+ (Xcode wrapper) |

Decrypts vault entries **in the extension**, with `@4allpass/crypto`. The server still only stores envelopes. This is **not** iOS Password AutoFill.

**Fill behaviour (P1):** [`autofill-v1.md`](autofill-v1.md) — Field Intelligence, Safe Fill, local verify. This file is install and pack layout only.

The desktop app cards can open the browser and show the folder. The browser still asks — we do not silently inject add-ons. No Mac login password for that.

## Build

```sh
cd ~/4AllPass
npm install
npm run build:extension
```

Writes `dist/chromium`, `dist/firefox`, and copies Chromium into the Safari Resources folder.

## Chromium family

Chrome / Brave / Edge / Arc / Vivaldi / Opera → Extensions → Developer mode → Load unpacked → `extension/dist/chromium`.

## Firefox

`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `extension/dist/firefox/manifest.json`. Firefox 128+. Grant the API origin if Unlock asks. Default API for the desktop app is `http://127.0.0.1:8788`.

## macOS Safari

```sh
npm run safari -w @4allpass/extension
```

Xcode: scheme **FourAllPass** → Run. Safari → Settings → Extensions. Unsigned: Develop → Developer settings.

iOS Safari Web Extension and system Password AutoFill are not this wrapper.

Popup: API (desktop `http://127.0.0.1:8788`) + **Tresor-Passwort / vault password** → **Entsperren / Unlock**. That is `POST /auth/local` — the desktop app has no e-mail account. Server deployments still open **Server-Konto** and sign in as before (`POST /auth/login`). Then **Diese Seite füllen / Fill this page**, `Ctrl+Shift+L` / `⌘⇧L`, or right-click → **Fill with 4AllPass**.

From the desktop Browser cards (open a card): **Demo-Login öffnen** saves a loopback test entry and opens `http://127.0.0.1:8788/test-login.html` in that browser. Not a general URL opener. The popup remembers API origin and optional e-mail; never the vault password.

A miss prints erkannt / recognized, gefüllt / filled, Ergebnis / result — never the secret. If a password was filled but the username sat under 0.70, **Trotzdem füllen / Fill anyway** writes that field after an explicit click. Never a lone search box. Local Playwright: `npm run test:e2e:autofill-local -w @4allpass/frontend`.

**GitHub.com:** two pages. Unlock the extension, open `https://github.com/login`, **Fill this page** (username), continue, **Fill this page** again (password). TOTP on the 2FA page if the entry has `totpSecret`. Not a multi-step engine.

## Not in this slice

Chrome Web Store / AMO / App Store listing. iOS AutoFill. Writing passwords back into Chrome’s own `Login Data`. Stille On-Load-Fills. See [`autofill-v1.md`](autofill-v1.md) §10.
