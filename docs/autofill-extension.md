# 4AllPass Chromium extension (MVP)

Decrypts vault entries **in the extension**, with `@4allpass/crypto`. The server still only stores envelopes.

## Load unpacked (Chrome / Brave / Edge)

```sh
cd ~/4AllPass
npm install
npm run build -w @4allpass/extension
```

Chrome → `chrome://extensions` → Developer mode → Load unpacked → `extension/dist`.

Popup: API (default `http://127.0.0.1:8000` or `:8010` if that port is taken), e-mail, sign-in password, vault password → **Unlock**. Then either:

- **Fill this page** in the popup, or
- `Ctrl+Shift+L` / `⌘⇧L` on the site, or
- right-click → **Fill with 4AllPass**.

Matching is by the entry **URL host** (and its subdomains), not by title. Signup forms that only have `autocomplete=new-password` are not filled. The badge shows how many unlocked entries match the active tab.

Plaintext entries live in the service-worker memory until **Lock**, the lock shortcut, or worker eviction. They are not written to `chrome.storage`.

Acceptance: login on `http://127.0.0.1:5173/test-login.html` without copy-paste after unlock (popup Fill, or the command / context menu).

## Not in this slice

Firefox/Safari add-ons, native iOS/Android Autofill, in-page keystroke overlays, filling sites whose entry has no URL.
