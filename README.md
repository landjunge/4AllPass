# 4AllPass

Self-hosted Zero-Knowledge password manager – for all browsers and devices.

Selective profile sharing, Argon2id, WebAuthn device unlock, PWA.

## Layout

| Path | What it is |
|---|---|
| [`packages/crypto`](packages/crypto) | `@4allpass/crypto` — Crypto Protocol v1 core. No UI, no network, no authenticator I/O |
| [`packages/webauthn`](packages/webauthn) | `@4allpass/webauthn` — device unlock: PRF > largeBlob > UV-gated local store |
| [`backend`](backend) | FastAPI + PostgreSQL + Redis. Stores opaque envelopes, snapshots, device metadata |
| [`frontend`](frontend) | React + TypeScript PWA. All cryptography happens here |
| [`docs`](docs) | The authoritative specifications |

## Documentation

- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Crypto Protocol v1: [`docs/crypto-protocol.md`](docs/crypto-protocol.md)
- WebAuthn PRF construction: [`docs/webauthn-prf.md`](docs/webauthn-prf.md)
- Vault revision / rotation: [`docs/vault-revision.md`](docs/vault-revision.md)
- Threat Model: [`docs/threat-model.md`](docs/threat-model.md)
- Database schema: [`docs/db-schema.md`](docs/db-schema.md)
- AES-256-GCM Testvektoren: [`docs/test-vectors.md`](docs/test-vectors.md)
- Argon2id Testvektoren: [`docs/test-vectors-argon2id.md`](docs/test-vectors-argon2id.md)

## Key path

```
Master password ──Argon2id──► Master Key ──unwraps──► Master Envelope ──► Vault Key
Recovery Key ─────────────────────────────unwraps──► Recovery Envelope ─► Vault Key
WebAuthn assertion + PRF ──HKDF──► DWK ──unwraps──► Device-Key Envelope ─► Device Key
                                                    Device Envelope ─────► Vault Key
```

The Vault Key is always random, never derived from a password. Raw PRF output is never used as a key.

## Project structure

```
4allpass/
├── docs/                 crypto & architecture specs (authoritative)
├── packages/crypto/      Zero-Knowledge crypto core
├── packages/webauthn/    WebAuthn PRF / largeBlob / UV-gated unlock
├── backend/              FastAPI + SQLAlchemy + Alembic + Redis
├── frontend/             React + TypeScript + PWA (Vite)
├── docker-compose.yml    Postgres + Redis + backend
└── scripts/              standalone test-vector verification
```

## Tests

```sh
npm install
npm test
npm run test:crypto:heavy   # includes 32–128 MiB Argon2id profiles
npm run test:webauthn
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

See [`backend/README.md`](backend/README.md).

## Docker Compose

```sh
docker compose up --build
```

Starts Postgres, Redis, and the backend on `http://localhost:8000`.
