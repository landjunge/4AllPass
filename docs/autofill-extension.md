# 4AllPass Chromium extension (MVP)

Decrypts vault entries **in the extension**, with `@4allpass/crypto`. The server still only stores envelopes.

## Load unpacked (Chrome / Brave / Edge)

```sh
cd ~/4AllPass
npm install
npm run build -w @4allpass/extension
```

Chrome → `chrome://extensions` → Developer mode → Load unpacked → `extension/dist`.

Popup: API (default `http://127.0.0.1:8000` or `:8010` if that port is taken), e-mail, sign-in password, vault password → **Unlock**. Open the site → **Fill this page**.

Acceptance: login on `http://127.0.0.1:5173/test-login.html` without copy-paste, at most two clicks after unlock (icon + Fill, or Fill from an already-open popup).

## Not in this slice

Firefox/Safari add-ons, native iOS/Android Autofill, automatic field detection on every keystroke.
