# 4AllPass

Self-hosted Zero-Knowledge password manager – for all browsers and devices.

Selective profile sharing, Argon2id, WebAuthn device unlock, PWA.

## Layout

| Path | What it is |
|---|---|
| [`packages/crypto`](packages/crypto) | `@4allpass/crypto` — Crypto Protocol v1 core. No UI, no network, no authenticator I/O |
| [`packages/webauthn`](packages/webauthn) | `@4allpass/webauthn` — device unlock: PRF > largeBlob > UV-gated local store |
| [`backend`](backend) | FastAPI + PostgreSQL + Redis. Account-Session, Ownership, Snapshot-CAS. Stores opaque envelopes only |
| [`frontend`](frontend) | React + TypeScript PWA. All cryptography happens here |
| [`docs`](docs) | The authoritative specifications |

## Documentation

- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Crypto Protocol v1: [`docs/crypto-protocol.md`](docs/crypto-protocol.md)
- WebAuthn PRF construction: [`docs/webauthn-prf.md`](docs/webauthn-prf.md)
- Vault revision / rotation / snapshot manifest: [`docs/vault-revision.md`](docs/vault-revision.md)
- Recovery Key & Emergency Kit: [`docs/recovery.md`](docs/recovery.md)
- Threat Model: [`docs/threat-model.md`](docs/threat-model.md)
- Adversarial review of the crypto core: [`docs/adversarial-review.md`](docs/adversarial-review.md)
- Security boundary (what is actually implemented): [`docs/security-boundary.md`](docs/security-boundary.md)
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
npm test                    # KATs + adversarial suite
npm run test:crypto:heavy   # includes 32–128 MiB Argon2id profiles
npm run test:webauthn
npm run test -w @4allpass/frontend
npm run test:e2e -w @4allpass/frontend   # needs Postgres, Redis and a running backend
npm run typecheck
node scripts/generate-vectors.mjs           # regenerate the KAT JSON (independent impl)
node scripts/verify-aes-gcm-vectors.mjs
pip install -r scripts/requirements-dev.txt
python3 scripts/verify-argon2id-vectors.py
```

## Backend

Account and vault HTTP API (`/api/v1`). The account password is **not** the
master password and cannot decrypt a vault.

```
POST /api/v1/auth/register | login | logout
GET  /api/v1/auth/me
GET/POST /api/v1/vaults
GET      /api/v1/vaults/{id}
GET      /api/v1/vaults/{id}/snapshot
POST     /api/v1/vaults/{id}/snapshots    # CAS: expectedRevision
         /api/v1/vaults/{id}/devices…     # owner-only
```

Every vault/device/snapshot route requires `Authorization: Bearer`. Foreign
vaults return **404** (no id enumeration).

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
