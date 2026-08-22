# Distribution — strangers can open the app

**DE:** Ohne Apple- und Windows-Signatur warnt das Betriebssystem. **Du** musst Konten und Zertifikate kaufen und als GitHub-Secrets eintragen. Die CI-Schritte dafür liegen auf Branch `feat/distribution-signing` (lokal, noch nicht auf `main`). Danach ein Tag `v*` pushen.

**EN:** Gatekeeper / SmartScreen warn until you sign. **You** buy the certificates and add GitHub secrets. Signing CI is on `feat/distribution-signing` until that branch is pushed. Then push a `v*` tag.

This is not App Store / Microsoft Store. FastAPI still never mints tokens.

## What you buy (this week)

| Platform | What | Typical cost | Time |
|---|---|---|
| macOS | [Apple Developer Program](https://developer.apple.com/programs/) + **Developer ID Application** certificate | ~99 USD / year | 1–2 days after enrollment |
| Windows | Code-signing certificate (OV). EV is faster for SmartScreen reputation | ~200–400 EUR / year (OV) | days to issue |
| Linux | nothing | AppImage already runs | — |

Without Apple, **every** Mac stranger must right-click → Open. That is not “strangers can use it.”

## GitHub secrets (Settings → Secrets and variables → Actions)

### macOS (required for notarization)

| Secret | What |
|---|---|
| `APPLE_CERTIFICATE` | Developer ID `.p12`, **base64** (`base64 -i cert.p12 | pbcopy`) |
| `APPLE_CERTIFICATE_PASSWORD` | Password of that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Netzwerkpunkt GmbH (TEAMID)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | [App-specific password](https://appleid.apple.com) — not your login password |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `KEYCHAIN_PASSWORD` | Any random password for the CI keychain |

### Windows (Authenticode)

| Secret | What |
|---|---|
| `WINDOWS_CERTIFICATE` | `.pfx` **base64** |
| `WINDOWS_CERTIFICATE_PASSWORD` | PFX password |
| `WINDOWS_CERTIFICATE_THUMBPRINT` | SHA-1 thumbprint of the imported cert |

SmartScreen can still warn for weeks on a new OV cert. EV + reputation is the honest path; we do not claim SmartScreen-clean on day one.

## After secrets exist

Push `feat/distribution-signing`, merge, then:

```sh
git tag v0.1.2
git push origin v0.1.2
```

Until those secrets exist, tagged releases stay **ad-hoc**. Do not tell strangers “just double-click.”

## Local unsigned build

`signingIdentity` is `"-"` in `tauri.conf.json` on current `main`. `npm run tauri:build` still makes an ad-hoc app.
