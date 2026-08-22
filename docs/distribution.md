# Distribution — strangers can open the app

**DE:** Ohne Apple- und Windows-Signatur warnt das Betriebssystem. Der Code in CI ist bereit; **du** musst Konten und Zertifikate kaufen und als GitHub-Secrets eintragen. Danach ein Tag `v*` pushen.

**EN:** Gatekeeper / SmartScreen warn until you sign. CI is ready; **you** buy the certificates, add GitHub secrets, then push a `v*` tag.

This is not App Store / Microsoft Store. FastAPI still never mints tokens.

## What you buy (this week)

| Platform | What | Typical cost | Time |
|---|---|---|---|
| macOS | [Apple Developer Program](https://developer.apple.com/programs/) + **Developer ID Application** certificate | ~99 USD / year | 1–2 days after enrollment |
| Windows | Code-signing certificate (OV). EV is faster for SmartScreen reputation | ~200–400 EUR / year (OV) | days to issue |
| Linux | nothing | AppImage already runs | — |

Without Apple, **every** Mac stranger must right-click → Open. That is not “strangers can use it.”

## GitHub secrets (Settings → Secrets and variables → Actions)

### macOS (required for notarization)

| Secret | What |
|---|---|
| `APPLE_CERTIFICATE` | Developer ID `.p12`, **base64** (`base64 -i cert.p12 \| pbcopy`) |
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

```sh
git tag v0.1.2
git push origin v0.1.2
```

CI (`desktop.yml`) signs, notarizes the DMG (`notarytool` + staple), signs the NSIS exe if the Windows secrets are set.

Check the Actions log for `Notarize macOS DMG`. Then download from [Releases](https://github.com/landjunge/4AllPass/releases) and open **without** right-click on a clean Mac.

Until those secrets exist, tagged releases stay **ad-hoc**. Do not tell strangers “just double-click.”

## Local unsigned build (you, on this Mac)

Unchanged: `signingIdentity` is `"-"` in `tauri.conf.json`. `npm run tauri:build` still makes an ad-hoc app.
