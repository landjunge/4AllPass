# 4AllPass

Self-hosted Zero-Knowledge Password Manager – for all browsers and devices.

Selektives Profil-Sharing, Argon2id, WebAuthn-Biometrie, PWA.

- Architektur: [`docs/architecture.md`](docs/architecture.md)
- Crypto Protocol v1: [`docs/crypto-protocol.md`](docs/crypto-protocol.md)
- WebAuthn PRF construction: [`docs/webauthn-prf.md`](docs/webauthn-prf.md)
- Vault revision / rotation: [`docs/vault-revision.md`](docs/vault-revision.md)
- Threat Model: [`docs/threat-model.md`](docs/threat-model.md)
- Crypto core: [`packages/crypto`](packages/crypto)
- AES-256-GCM Testvektoren: [`docs/test-vectors.md`](docs/test-vectors.md)
- Argon2id Testvektoren: [`docs/test-vectors-argon2id.md`](docs/test-vectors-argon2id.md)

## Struktur

| Pfad | Inhalt |
|---|---|
| `packages/crypto` | Crypto-Core (TypeScript-Referenzimplementierung von Protocol v1, inkl. WebAuthn PRF → HKDF → DWK) |
| `apps/api` | FastAPI + PostgreSQL + Redis: Snapshots, Key Envelopes, Device-Key-Envelope-Mirror, WebAuthn-Challenges |
| `apps/web` | React + TypeScript PWA: Unlock-UI, WebAuthn-PRF-Flow, lokaler Zero-Knowledge-Demo-Vault |

## Crypto-Core & Web

```sh
npm install
npm test                    # crypto + web (WebAuthn-PRF-Flow mit Software-Authenticator)
npm run test:crypto:heavy   # includes 32–128 MiB Argon2id profiles
npm run typecheck
npm run dev:web             # Vite dev server (proxied auf API :8000)
node scripts/verify-aes-gcm-vectors.mjs
pip install -r scripts/requirements-dev.txt
python3 scripts/verify-argon2id-vectors.py
```

## Backend

```sh
cd apps/api
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/alembic upgrade head            # braucht FOURALLPASS_DATABASE_URL bzw. Default-Postgres
.venv/bin/uvicorn app.main:app --reload
.venv/bin/python -m pytest                # braucht Postgres (fourallpass_test) + Redis
```

## Docker

```sh
docker compose up --build     # postgres + redis + api (:8000) + web (:5173)
```
