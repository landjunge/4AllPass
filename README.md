# 4AllPass

<p align="center"><img src="frontend/public/logo.png" alt="4AllPass" width="420" /></p>

**Sicherer Credential-Zugang für Menschen, Anwendungen und KI-Agenten.**

Deine Agenten brauchen Zugang. Nicht deine Secrets.

```text
Mensch / App / Agent → Anfrage → Richtlinie → erlauben / ablehnen → zeitlich begrenzter Zugang → Anbieter
```

Kein „besserer Bitwarden“. Die Geräte besitzen den Tresor kryptografisch. Der Einstieg ist Agent-Zugang — Plan: [`docs/eight-week-agent-access.md`](docs/eight-week-agent-access.md). Im Access-Tab gibt es eine lokale [Zwei-Minuten-Demo](docs/two-minute-demo.md). Optionaler Loopback-Broker für einen fremden Prozess: [`docs/local-access-broker.md`](docs/local-access-broker.md) (`npm run broker`, Pairing-Token, nicht FastAPI). FastAPI gibt **keine** Tokens aus. Es gibt keinen n8n-Marketplace-Node.

Heute: selbst gehosteter Zero-Knowledge-Tresor, Argon2id, WebAuthn-Geräteentsperrung, PWA, Autofill in Chromium/Firefox/macOS Safari. Item-Share ist eine verschlüsselte Datei plus Share-Key; der Server sieht beides nicht. Umschlagen auf den Device Key einer anderen Person ist nicht in v1. Siehe [`docs/positioning.md`](docs/positioning.md).

---

## English

**Secure credential access for humans, applications and AI agents.**

Your agents need access. They don't need your secrets. Self-hosted zero-knowledge vault. FastAPI never mints tokens. Setup: native Homebrew Postgres + Redis, same commands as below. Docker is optional and not required.

---

## Einrichten / Setup

**Kein Docker.** Homebrew Postgres + Redis, dann API + PWA. Konto-Passwort ≠ Vault-Passwort. Logo inkl. Schriftzug.

### 1. Postgres und Redis

```sh
brew install postgresql@17 redis
brew services start postgresql@17
brew services start redis

createuser fourallpass --pwprompt    # Passwort: fourallpass
createdb fourallpass -O fourallpass
```

User, Passwort und Datenbank heißen `fourallpass` (siehe `backend/.env.example`). User/DB überspringen, wenn sie schon existieren.

### 2. API und PWA

Dieses Mac: Port **8000** gehört einer anderen App → API **8010**, PWA **5173**. Ist 8000 frei: `--port 8000` und `API_ORIGIN` weglassen.

```sh
git clone https://github.com/landjunge/4AllPass.git   # oder bestehendes Clone
cd 4AllPass
npm install
cp -n backend/.env.example backend/.env
# in backend/.env: FOURALLPASS_SESSION_SECRET auf einen eigenen Wert setzen

cd backend
python3 -m venv .venv
source .venv/bin/activate
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

PWA: [http://127.0.0.1:5173](http://127.0.0.1:5173)

Dann: Konto anlegen → Tresor → Recovery-Kit bestätigen → Access-Tab (Zwei-Minuten-Demo).

GitHub sichtbar machen: [`docs/github-sichtbarkeit.md`](docs/github-sichtbarkeit.md).

### Optional: Docker

Nicht nötig. Wer Container will: `docker compose up --build` → PWA `:8080`, API `:8000`. Nicht parallel zum Native-Pfad (Ports 5432 / 6379 / 8000).

## Aufbau

| Pfad | Was es ist |
|---|---|
| [`packages/crypto`](packages/crypto) | `@4allpass/crypto` — Crypto Protocol v1. Kein UI, kein Netz, kein Authenticator-I/O |
| [`packages/webauthn`](packages/webauthn) | `@4allpass/webauthn` — Geräteentsperrung: PRF > largeBlob > UV-gespeicherter Store |
| [`backend`](backend) | FastAPI + PostgreSQL + Redis. Konto-Session, Besitz, Snapshot-CAS. Nur undurchsichtige Envelopes |
| [`frontend`](frontend) | React + TypeScript PWA. Die gesamte Kryptographie läuft hier |
| [`extension`](extension) | Chromium + Firefox MV3 + macOS-Safari-Autofill. Entschlüsselt auf dem Gerät über `@4allpass/crypto` |
| [`docs`](docs) | Die verbindlichen Spezifikationen |

Mitmachen: [`CONTRIBUTING.md`](CONTRIBUTING.md). Sicherheitsmeldungen: [`SECURITY.md`](SECURITY.md). Board: [4AllPass-Projekt](https://github.com/users/landjunge/projects/2).

## Warum dem trauen?

Der Server ist ein Blob-Store. Er sieht weder Master-Passwort noch Vault Key noch Klartext-Einträge. Das kannst du an öffentlichen Specs und Tests prüfen, nicht an einer Marketingseite:

- Was Backend + PWA **wirklich** erzwingen: [`docs/security-boundary.md`](docs/security-boundary.md)
- Bedrohungsmodell: [`docs/threat-model.md`](docs/threat-model.md)
- Adversarial Review des Crypto-Cores: [`docs/adversarial-review.md`](docs/adversarial-review.md)
- AES-256-GCM-KATs: [`docs/test-vectors.md`](docs/test-vectors.md)
- Argon2id-KATs: [`docs/test-vectors-argon2id.md`](docs/test-vectors-argon2id.md)
- Recovery (kein Server-Reset): [`docs/recovery.md`](docs/recovery.md)
- Audit-Karte für Dritte: [`docs/audit-scope.md`](docs/audit-scope.md)
- Reproduzierbarer PWA-/Extension-Tree-Hash: [`docs/reproducible-builds.md`](docs/reproducible-builds.md)

Es gibt **noch kein** unabhängiges Drittaudit. Geplanter Umfang: `docs/audit-scope.md`. Feature-Vergleich (ehrlich ✅ / ⏳): [`docs/comparison.md`](docs/comparison.md).

## Dokumentation

- Agent-Playbook (Review / Code / Improve): [`.cursor/skills/4allpass/SKILL.md`](.cursor/skills/4allpass/SKILL.md)
- Produktplan: [`docs/development-plan.md`](docs/development-plan.md)
- Positionierung (Ist-Behauptungen): [`docs/positioning.md`](docs/positioning.md)
- 8-Wochen-Plan Agent-Zugang: [`docs/eight-week-agent-access.md`](docs/eight-week-agent-access.md)
- Zwei-Minuten-Access-Demo: [`docs/two-minute-demo.md`](docs/two-minute-demo.md)
- Lokaler Loopback-Broker (optional, nicht FastAPI): [`docs/local-access-broker.md`](docs/local-access-broker.md)
- Launch-Artikel: [`docs/your-ai-agent-doesnt-need-your-api-keys.md`](docs/your-ai-agent-doesnt-need-your-api-keys.md)
- Launch-Post-Entwürfe: [`docs/launch-posts.md`](docs/launch-posts.md)
- GitHub sichtbar nutzen: [`docs/github-sichtbarkeit.md`](docs/github-sichtbarkeit.md)

- Crypto Protocol v1: [`docs/crypto-protocol.md`](docs/crypto-protocol.md)
- WebAuthn-PRF: [`docs/webauthn-prf.md`](docs/webauthn-prf.md)
- Vault-Revision / Rotation / Snapshot-Manifest: [`docs/vault-revision.md`](docs/vault-revision.md)
- Recovery Key & Emergency Kit: [`docs/recovery.md`](docs/recovery.md)
- Threat Model: [`docs/threat-model.md`](docs/threat-model.md)
- Adversarial Review: [`docs/adversarial-review.md`](docs/adversarial-review.md)
- Security Boundary (was wirklich läuft): [`docs/security-boundary.md`](docs/security-boundary.md)
- AES-256-GCM-Testvektoren: [`docs/test-vectors.md`](docs/test-vectors.md)
- Argon2id-Testvektoren: [`docs/test-vectors-argon2id.md`](docs/test-vectors-argon2id.md)
- Post-Quantum-Roadmap (nur Konzept): [`docs/post-quantum-roadmap.md`](docs/post-quantum-roadmap.md)
- Selektiver Item-Share (verschlüsselte Datei, v1): [`docs/sharing.md`](docs/sharing.md)

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
├── backend/              FastAPI + SQLAlchemy + Alembic + Redis
├── frontend/             React + TypeScript + PWA (Vite)
├── docker-compose.yml    optional; Native braucht das nicht
└── scripts/              unabhängige Testvektor-Prüfung
```

## Tests

```sh
npm install
npm test                    # KATs + Adversarial-Suite
npm run test:crypto:heavy   # inkl. 32–128 MiB Argon2id-Profile
npm run test:webauthn
npm run test -w @4allpass/frontend
npm run test:e2e -w @4allpass/frontend   # braucht Postgres, Redis und laufendes Backend
npm run test:e2e:live                    # sichtbares Chrome/Firefox/Brave/WebKit auf diesem Mac
# siehe docs/live-browser-test.md
npm run build -w @4allpass/extension
# siehe docs/autofill-extension.md
npm run typecheck
node scripts/generate-vectors.mjs
node scripts/verify-aes-gcm-vectors.mjs
pip install -r scripts/requirements-dev.txt
python3 scripts/verify-argon2id-vectors.py
```

## Backend

Konto- und Vault-HTTP-API (`/api/v1`). Das Konto-Passwort ist **nicht** das Master-Passwort und kann einen Tresor nicht entschlüsseln.

```
POST /api/v1/auth/register | login | logout
GET  /api/v1/auth/me
GET/POST /api/v1/vaults
GET      /api/v1/vaults/{id}
GET      /api/v1/vaults/{id}/snapshot
POST     /api/v1/vaults/{id}/snapshots    # CAS: expectedRevision
         /api/v1/vaults/{id}/devices…
POST     /api/v1/vaults/{id}/webauthn/challenges
POST     /api/v1/vaults/{id}/webauthn/challenges/{id}/consume
```

Jede Vault-/Device-/Snapshot-Route braucht `Authorization: Bearer`. Fremde Vaults liefern **404** (keine ID-Enumeration).

```sh
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload
pytest
```

Siehe [`backend/README.md`](backend/README.md).

## Docker Compose (optional)

Nicht der empfohlene Weg. Native: Abschnitt Einrichten.

```sh
docker compose up --build
```

Startet Postgres, Redis und das Backend auf `http://localhost:8000`.
