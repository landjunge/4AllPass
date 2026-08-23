# 4AllPass browser extensions

One source (`extension/src`). **Three installable packs** so every browser you tick can load an add-on:

| Pack | Browsers |
|---|---|
| `extension/dist/chromium` | Chrome, Chrome Canary, Brave, Edge, Arc, Vivaldi, Opera, Opera GX, Chromium |
| `extension/dist/firefox` | Firefox, Firefox Developer, Firefox Nightly (128+) |
| `extension/safari/` | macOS Safari 16.4+ (Xcode wrapper) |

Decrypts vault entries **in the extension**, with `@4allpass/crypto`. The server still only stores envelopes. This is **not** iOS Password AutoFill.

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

Popup: API (desktop `http://127.0.0.1:8788`), e-mail, sign-in password, vault password → **Unlock**. Then **Fill this page**, `Ctrl+Shift+L` / `⌘⇧L`, or right-click → **Fill with 4AllPass**.

## Not in this slice

Chrome Web Store / AMO / App Store listing. iOS AutoFill. Writing passwords back into Chrome’s own `Login Data`.
