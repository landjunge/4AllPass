# 4AllPass

Self-hosted Zero-Knowledge Password Manager – for all browsers and devices.

Selektives Profil-Sharing, Argon2id, WebAuthn-Biometrie, PWA.

```
apps/api          FastAPI + PostgreSQL + Redis (opaque envelopes only)
apps/web          React + TypeScript PWA
packages/crypto   Crypto Protocol v1 (WebAuthn PRF → HKDF → DWK → DK)
frontend          React + TypeScript + PWA scaffold
backend           FastAPI + PostgreSQL + Redis scaffold
docs/             architecture, crypto, WebAuthn PRF, revisions, vectors
```

- Architektur: [`docs/architecture.md`](docs/architecture.md)
- Crypto Protocol v1: [`docs/crypto-protocol.md`](docs/crypto-protocol.md)
- WebAuthn PRF construction: [`docs/webauthn-prf.md`](docs/webauthn-prf.md)
- Vault revision / rotation: [`docs/vault-revision.md`](docs/vault-revision.md)
- Threat Model: [`docs/threat-model.md`](docs/threat-model.md)
- Crypto core: [`packages/crypto`](packages/crypto)
- Backend (FastAPI + PostgreSQL + Redis): [`backend`](backend)
- Frontend (React + TypeScript + PWA): [`frontend`](frontend)
- API / Device Envelope schema: [`apps/api`](apps/api)
- Web app scaffold: [`apps/web`](apps/web)
- AES-256-GCM Testvektoren: [`docs/test-vectors.md`](docs/test-vectors.md)
- Argon2id Testvektoren: [`docs/test-vectors-argon2id.md`](docs/test-vectors-argon2id.md)

## Project structure

```text
4allpass/
├── docs/              crypto & architecture specs (authoritative)
├── packages/crypto/   Zero-Knowledge crypto core (TypeScript, no server dependency)
├── backend/           FastAPI + SQLAlchemy + Alembic + Redis
├── frontend/          React + TypeScript + PWA (Vite), consumes @4allpass/crypto
├── apps/api/          Monorepo API scaffold for opaque Device Envelopes
├── apps/web/          Monorepo web scaffold that imports @4allpass/crypto
├── docker-compose.yml Postgres + Redis + backend for local/dev use
└── scripts/           standalone test-vector verification scripts
```

## Crypto core & frontend/JS tests

```sh
npm install
npm test
npm run test:crypto:heavy   # includes 32–128 MiB Argon2id profiles
npm run test:frontend
npm run typecheck
node scripts/verify-aes-gcm-vectors.mjs
pip install -r scripts/requirements-dev.txt
python3 scripts/verify-argon2id-vectors.py

python3 -m venv apps/api/.venv
apps/api/.venv/bin/pip install -e "apps/api[dev]"
apps/api/.venv/bin/pytest apps/api/tests
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
