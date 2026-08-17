# 4AllPass

Self-hosted Zero-Knowledge Password Manager – for all browsers and devices.

Selektives Profil-Sharing, Argon2id, WebAuthn-Biometrie, PWA.

- Architektur: [`docs/architecture.md`](docs/architecture.md)
- Crypto Protocol v1: [`docs/crypto-protocol.md`](docs/crypto-protocol.md)
- WebAuthn PRF construction: [`docs/webauthn-prf.md`](docs/webauthn-prf.md)
- Vault revision / rotation: [`docs/vault-revision.md`](docs/vault-revision.md)
- Threat Model: [`docs/threat-model.md`](docs/threat-model.md)
- Crypto core: [`packages/crypto`](packages/crypto)
- Backend (FastAPI + PostgreSQL + Redis): [`backend`](backend)
- Frontend (React + TypeScript + PWA): [`frontend`](frontend)
- AES-256-GCM Testvektoren: [`docs/test-vectors.md`](docs/test-vectors.md)
- Argon2id Testvektoren: [`docs/test-vectors-argon2id.md`](docs/test-vectors-argon2id.md)

## Project structure

```
4allpass/
├── docs/              crypto & architecture specs (authoritative)
├── packages/crypto/   Zero-Knowledge crypto core (TypeScript, no server dependency)
├── backend/           FastAPI + SQLAlchemy + Alembic + Redis
├── frontend/          React + TypeScript + PWA (Vite), consumes @4allpass/crypto
├── docker-compose.yml Postgres + Redis + backend for local/dev use
└── scripts/           standalone test-vector verification scripts
```

## Crypto core & frontend/JS tests

```sh
npm install
npm test
npm run test:crypto:heavy   # includes 32–128 MiB Argon2id profiles
npm run test -w @4allpass/frontend
node scripts/verify-aes-gcm-vectors.mjs
pip install -r scripts/requirements-dev.txt
python3 scripts/verify-argon2id-vectors.py
```

## Backend

```sh
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload
pytest
```

See [`backend/README.md`](backend/README.md) for the database schema (including the
**Device Envelope** / **Device-Key Envelope** tables from `docs/webauthn-prf.md`) and test
setup details.

## Everything via Docker Compose

```sh
docker compose up --build
```

Starts Postgres, Redis, and the backend (running Alembic migrations on boot) on
`http://localhost:8000`.
