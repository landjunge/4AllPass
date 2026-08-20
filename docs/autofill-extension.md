# 4AllPass browser extension (Chromium + Firefox)

Decrypts vault entries **in the extension**, with `@4allpass/crypto`. The server still only stores envelopes. One MV3 bundle; Firefox 128+ (`browser` API, `addon@4allpass.local`). Safari is not in this slice.

## Build

```sh
cd ~/4AllPass
npm install
npm run build -w @4allpass/extension
```

## Load unpacked (Chrome / Brave / Edge)

Chrome → `chrome://extensions` → Developer mode → Load unpacked → `extension/dist`.

## Load temporarily (Firefox)

`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `extension/dist/manifest.json`. Firefox 128+. Grant the API origin if the Unlock prompt asks.

Popup: API (default `http://127.0.0.1:8000` or `:8010` if that port is taken), e-mail, sign-in password, vault password → **Unlock**. Then either:

- **Fill this page** in the popup, or
- `Ctrl+Shift+L` / `⌘⇧L` on the site, or
- right-click → **Fill with 4AllPass**.

Matching is by the entry **URL host** (and its subdomains), not by title. Signup forms that only have `autocomplete=new-password` are not filled. The badge shows how many unlocked entries match the active tab.

Plaintext entries live in the service-worker memory until **Lock**, the lock shortcut, **5 minutes of idle**, or worker eviction. Closing the popup does not lock, so the keyboard shortcut still works until idle lock. They are not written to `chrome.storage`. Chrome `alarms` backs the idle timer if the worker sleeps while still holding a session.

Acceptance: login on `http://127.0.0.1:5173/test-login.html` without copy-paste after unlock (popup Fill, or the command / context menu).

## Not in this slice

Safari Web Extension, native iOS/Android Autofill, in-page keystroke overlays, filling sites whose entry has no URL. AMO / Chrome Web Store listing.
