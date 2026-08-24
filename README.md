# 4AllPass

<p align="center"><img src="frontend/public/logo.png" alt="4AllPass" width="420" /></p>

**DE:** Lokaler Passwort-Tresor. Browser-Passwörter holen, Autofill, Zero-Knowledge. Agenten bekommen Zugang nur nach Allow/Deny — nicht als ersten Bildschirm.

**EN:** Local-first password vault. Import from browsers, autofill, zero-knowledge. Agents get limited access only after Allow/Deny — not the first screen.

```text
Install → Import → Autofill → fertig
Agent → Access-Tab (Allow/Deny + TTL) — Advanced
```

Kein Cloud-Account bei uns. Der Server sieht keinen Klartext. FastAPI mintet **keine** Tokens. **Produkt ist die Desktop-App** ([`docs/desktop.md`](docs/desktop.md)). Haltung: [`docs/product-philosophy.md`](docs/product-philosophy.md) — Produkt zuerst, Sicherheit und Eigentum werden nicht verkauft.

---

## Heute / Today (ehrlich)

| | DE | EN |
|---|---|---|
| Produkt | Desktop (Tauri), SQLite, Loopback `:8788` | Desktop app, SQLite, loopback `:8788` |
| Tresor | Geräte besitzen den Vault kryptografisch. Unlock = Tresor-Passwort | Devices own the vault cryptographically. Unlock = vault password |
| Import | Browser-Karten, Chrome/Firefox, Review **ohne** Passwort in der Liste | Browser cards, Chrome/Firefox, review **without** passwords in the list |
| Autofill | Chromium + Firefox + Safari-Wrapper. Field Intelligence + Safe Fill. Demo-Login ohne Copy-Paste (Playwright). GitHub-Live **noch nicht** abgehakt | Chromium + Firefox + Safari wrapper. Field Intelligence + Safe Fill. Demo login without copy-paste (Playwright). Live GitHub **not** checked off |
| Extension-Unlock | Nur Tresor-Passwort gegen `http://127.0.0.1:8788` (`POST /auth/local`) | Vault password only against `http://127.0.0.1:8788` |
| Agent | Loopback-Broker, Origin 403, Pairing-Token. Identität ist ein **String** (`n8n`) | Loopback broker, Origin 403, pairing token. Identity is a **string** |
| Recovery | Emergency Kit, kein Server-Reset | Emergency kit, no server reset |
| WebAuthn PRF | Im Protokoll; in der Tauri-Webview **unbewiesen** | In the protocol; **unproven** in the Tauri webview |
| Team Mode | Spec, **kein Code** — Organisation = Grenze, kein PAM | Spec, **no code** — org is a boundary, not PAM |
| Apple | Notarisierung **pausiert** (~99 USD/Jahr) | Notarization **paused** |
| Audit | Kein unabhängiges Drittaudit | No third-party audit yet |

Details: [`docs/comparison.md`](docs/comparison.md), [`docs/product-maturity.md`](docs/product-maturity.md), [`docs/security-boundary.md`](docs/security-boundary.md).

---

## Nutzen / Use

1. App starten (DMG ad-hoc oder `npm run app`).
2. Tresor anlegen, Recovery-Kit bestätigen — 4AllPass kann ohne Kit / zweites Gerät **nicht** zurücksetzen.
3. Browser-Karten: Profile anhaken, Passwörter holen, Review, Confirm. Nie still, nie in Chrome zurückschreiben.
4. Extension laden (unpacked `extension/dist/chromium` oder Firefox-Pack). **Demo-Login öffnen.** Popup: nur Tresor-Passwort → **Diese Seite füllen / Fill this page**.

Agent-Zugang: Access-Tab, nicht der Einstieg. n8n: [`docs/local-access-broker.md`](docs/local-access-broker.md).

---

## Einrichten / Setup

**App zuerst.** Kein Postgres, kein Redis, kein zweites Terminal. Konto-Passwort (Server-Profil) ≠ Tresor-Passwort. Logo inkl. Schriftzug.

### Ein Befehl / One command

Nicht notariert. Du vertraust diesem GitHub-Repo. `xattr` auf dem Mac ist dasselbe Vertrauenslevel wie Rechtsklick → Öffnen. Der Tresor-Ordner wird **nicht** gelöscht. Unlock bleibt das Tresor-Passwort.

```sh
curl -fsSL https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.sh | sh
```

Ohne Pipe: Script speichern, lesen, `sh install.sh`. Windows: `irm https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.ps1 | iex`.

### Desktop (DMG / Installer)

Download: [Releases](https://github.com/landjunge/4AllPass/releases). Der One-Liner nutzt den rolling Prerelease-Tag **`desktop`** (Intel `*_x64.dmg` + SHA-256). Versionierte Tags bleiben `v*` — kein `v0.1.2` nur für Installer.

- **Intel Mac:** `*_x64.dmg` (CI `macos-15-intel`). Apple-Silicon: `*_aarch64.dmg`.
- **One-Liner:** Quarantäne per `xattr` weg, Fenster geht auf. Manuelles DMG: Rechtsklick → Öffnen.
- **Notarisierung pausiert** (Apple Developer ~99 USD/Jahr) — [`docs/distribution.md`](docs/distribution.md), [#112](https://github.com/landjunge/4AllPass/issues/112).

Ohne Installer: `npm run app` → [http://127.0.0.1:8788](http://127.0.0.1:8788). Beim Anmelden starten entsperrt den Tresor **nicht**.

Selbst bauen:

```sh
git clone https://github.com/landjunge/4AllPass.git
cd 4AllPass
npm install
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cd ..
npm run build:extension
npm run tauri:build
```

Windows-NSIS / Linux-AppImage: CI (`.github/workflows/desktop.yml`) oder `npm run tauri:build:windows` / `:linux` auf dem jeweiligen OS.

Dev-Fenster: `npm run tauri:dev`.

### Server (optional, mehrere Nutzer)

Nur wenn die API auf einem Rechner für mehrere Clients läuft. Die lokale App braucht das nicht.

```sh
brew install postgresql@17 redis
brew services start postgresql@17
brew services start redis
createuser fourallpass --pwprompt    # Passwort: fourallpass
createdb fourallpass -O fourallpass
```

User, Passwort und Datenbank heißen `fourallpass` (`backend/.env.example`).

```sh
cd 4AllPass
npm install
cp -n backend/.env.example backend/.env
# FOURALLPASS_SESSION_SECRET auf einen eigenen Wert setzen

cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
FOURALLPASS_SESSION_SECRET=dev-local-not-for-production \
  uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Zweites Terminal:

```sh
cd 4AllPass/frontend
API_ORIGIN=http://127.0.0.1:8010 npm run dev -- --host 127.0.0.1
```

PWA-Dev: [http://127.0.0.1:5173](http://127.0.0.1:5173). Extension gegen den Server: Popup → Server-Konto (E-mail + Konto-Passwort) + Tresor-Passwort.

### Optional: Docker

Nicht nötig. `docker compose up --build` → PWA `:8080`, API `:8000`. Nicht parallel zum Native-Pfad.

---

## Aufbau

| Pfad | Was es ist |
|---|---|
| [`packages/crypto`](packages/crypto) | `@4allpass/crypto` — Crypto Protocol v1. Kein UI, kein Netz, kein Authenticator-I/O |
| [`packages/webauthn`](packages/webauthn) | `@4allpass/webauthn` — Geräteentsperrung: PRF > largeBlob > UV-gespeicherter Store |
| [`packages/core`](packages/core) | `@4allpass/core` — Access-Policy, Grant-Metadaten, Audit. Kein Secret. `allow` = menschlicher Allow, nicht Auto-Handoff |
| [`packages/providers`](packages/providers) | `@4allpass/providers` — Domain → Provider + Confidence. Lokal, kein Netz. `evilgithub.com` ≠ GitHub |
| [`packages/access`](packages/access) | `@4allpass/access` — Loopback-Client für Agenten. Nicht FastAPI |
| [`packages/broker`](packages/broker) | `@4allpass/broker` — Dev-Relay `:8787`. Produkt-Broker ist der Sidecar (`broker.py` auf `:8788`) |
| [`backend`](backend) | FastAPI. Lokal: SQLite + Memory-Sessions. Server: PostgreSQL + Redis. Nur undurchsichtige Envelopes |
| [`frontend`](frontend) | React + TypeScript. Die gesamte Kryptographie läuft hier |
| [`src-tauri`](src-tauri) | Desktop-Fenster (Tauri). UI vom lokalen Origin `:8788` |
| [`extension`](extension) | Chromium-Familie + Firefox + macOS-Safari. Ein Source, drei Packs. Entschlüsselt auf dem Gerät |
| [`docs`](docs) | Die verbindlichen Spezifikationen |

Mitmachen: [`CONTRIBUTING.md`](CONTRIBUTING.md). Sicherheitsmeldungen: [`SECURITY.md`](SECURITY.md). Board: [4AllPass-Projekt](https://github.com/users/landjunge/projects/2).

## Warum dem trauen?

Der Server ist ein Blob-Store. Er sieht weder Master-Passwort noch Vault Key noch Klartext-Einträge. Das steht in Specs und Tests, nicht auf einer Marketingseite:

- Was Backend + App **wirklich** erzwingen: [`docs/security-boundary.md`](docs/security-boundary.md)
- Bedrohungsmodell: [`docs/threat-model.md`](docs/threat-model.md)
- Adversarial Review: [`docs/adversarial-review.md`](docs/adversarial-review.md)
- AES-256-GCM-KATs: [`docs/test-vectors.md`](docs/test-vectors.md)
- Argon2id-KATs: [`docs/test-vectors-argon2id.md`](docs/test-vectors-argon2id.md)
- Recovery (kein Server-Reset): [`docs/recovery.md`](docs/recovery.md)
- Audit-Karte: [`docs/audit-scope.md`](docs/audit-scope.md)
- Reproduzierbarer Tree-Hash: [`docs/reproducible-builds.md`](docs/reproducible-builds.md)

Es gibt **noch kein** unabhängiges Drittaudit. Vergleich (ehrlich ✅ / ⚠️ / ⏳): [`docs/comparison.md`](docs/comparison.md).

## Dokumentation

Produkt:

- Philosophie (kein Businessplan): [`docs/product-philosophy.md`](docs/product-philosophy.md)
- Produktreife v3: [`docs/product-maturity.md`](docs/product-maturity.md)
- Positionierung: [`docs/positioning.md`](docs/positioning.md)
- Browser-Sync: [`docs/browser-sync.md`](docs/browser-sync.md)
- Autofill V1: [`docs/autofill-v1.md`](docs/autofill-v1.md)
- Extension bauen/laden: [`docs/autofill-extension.md`](docs/autofill-extension.md)
- Provider (Domain ≠ Name): [`docs/provider-resolution.md`](docs/provider-resolution.md)
- Desktop: [`docs/desktop.md`](docs/desktop.md)
- Distribution / Apple: [`docs/distribution.md`](docs/distribution.md)
- Team Mode (**Review, nicht gebaut**): [`docs/team-mode.md`](docs/team-mode.md), [`docs/team-roadmap.md`](docs/team-roadmap.md)
- Agent-Playbook: [`.cursor/skills/4allpass/SKILL.md`](.cursor/skills/4allpass/SKILL.md)

Zugang / Broker:

- Loopback-Broker: [`docs/local-access-broker.md`](docs/local-access-broker.md)
- Zwei-Minuten-Demo: [`docs/two-minute-demo.md`](docs/two-minute-demo.md)

Crypto (verbindlich):

- Crypto Protocol v1: [`docs/crypto-protocol.md`](docs/crypto-protocol.md)
- WebAuthn-PRF: [`docs/webauthn-prf.md`](docs/webauthn-prf.md)
- Vault-Revision: [`docs/vault-revision.md`](docs/vault-revision.md)
- Recovery: [`docs/recovery.md`](docs/recovery.md)
- Threat Model: [`docs/threat-model.md`](docs/threat-model.md)
- Security Boundary: [`docs/security-boundary.md`](docs/security-boundary.md)
- Item-Share: [`docs/sharing.md`](docs/sharing.md)
- Post-Quantum (Konzept): [`docs/post-quantum-roadmap.md`](docs/post-quantum-roadmap.md)

Launch-Entwürfe nicht auto-publishen: [`docs/launch-posts.md`](docs/launch-posts.md).

## Schlüsselpfad

```
Master-Passwort ──Argon2id──► Master Key ──unwraps──► Master Envelope ──► Vault Key
Recovery Key ─────────────────────────────unwraps──► Recovery Envelope ─► Vault Key
WebAuthn-Assertion + PRF ──HKDF──► DWK ──unwraps──► Device-Key Envelope ─► Device Key
                                                     Device Envelope ─────► Vault Key
```

Der Vault Key ist immer zufällig, nie aus einem Passwort abgeleitet. Roher PRF-Output ist nie ein Schlüssel.

## Projektstruktur

```
4allpass/
├── docs/                 verbindliche Specs
├── packages/crypto/      Zero-Knowledge-Crypto-Kern
├── packages/webauthn/    WebAuthn PRF / largeBlob / UV-Unlock
├── packages/core/        Access-Policy + Grant-Metadaten (kein Secret)
├── packages/providers/   Domain → Provider (kein Netz)
├── packages/access/      Agent-Loopback-Client
├── packages/broker/      Dev-Node-Relay :8787 (Produkt: Sidecar)
├── backend/              FastAPI; lokal SQLite
├── frontend/             React + TypeScript + PWA (Vite)
├── extension/            Autofill (Chromium / Firefox / Safari-Wrapper)
├── src-tauri/            Desktop (Tauri)
├── docker-compose.yml    optional; Native braucht das nicht
└── scripts/              unabhängige Testvektor-Prüfung
```

## Tests

```sh
npm install
npm test                    # KATs + Adversarial-Suite + core/broker/extension
npm run test:crypto:heavy   # inkl. 32–128 MiB Argon2id-Profile
npm run test:webauthn
npm run typecheck
npm run build:extension     # siehe docs/autofill-extension.md
node scripts/verify-aes-gcm-vectors.mjs
python3 scripts/verify-argon2id-vectors.py
cd backend && pytest
```

## Backend

Konto- und Vault-HTTP-API (`/api/v1`). Das Konto-Passwort ist **nicht** das Master-Passwort und kann einen Tresor nicht entschlüsseln. Lokal: `POST /api/v1/auth/local` (kein E-Mail-Konto).

```
POST /api/v1/auth/register | login | logout | local
GET  /api/v1/auth/me
GET/POST /api/v1/vaults
GET      /api/v1/vaults/{id}/snapshot
POST     /api/v1/vaults/{id}/snapshots    # CAS: expectedRevision
         /api/v1/vaults/{id}/devices…
POST     /api/v1/vaults/{id}/webauthn/challenges
```

Fremde Vaults liefern **404**. Kein `/v1/access` auf FastAPI — der Broker ist Loopback.

Siehe [`backend/README.md`](backend/README.md).
