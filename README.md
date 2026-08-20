# 4AllPass

Self-hosted Zero-Knowledge password manager – for all browsers and devices.

Argon2id, WebAuthn device unlock, PWA. Selective profile sharing is specified, not shipped in the PWA yet.

**Positioning:** your devices own the vault cryptographically, not just organisationally. Not “a nicer Bitwarden.” See [`docs/positioning.md`](docs/positioning.md).

## Layout

| Path | What it is |
|---|---|
| [`packages/crypto`](packages/crypto) | `@4allpass/crypto` — Crypto Protocol v1 core. No UI, no network, no authenticator I/O |
| [`packages/webauthn`](packages/webauthn) | `@4allpass/webauthn` — device unlock: PRF > largeBlob > UV-gated local store |
| [`backend`](backend) | FastAPI + PostgreSQL + Redis. Account-Session, Ownership, Snapshot-CAS. Stores opaque envelopes only |
| [`frontend`](frontend) | React + TypeScript PWA. All cryptography happens here |
| [`extension`](extension) | Chromium MV3 autofill. Decrypts on-device via `@4allpass/crypto` |
| [`docs`](docs) | The authoritative specifications |

How to contribute: [`CONTRIBUTING.md`](CONTRIBUTING.md). Security reports: [`SECURITY.md`](SECURITY.md). Board: [4AllPass project](https://github.com/users/landjunge/projects/2).

## Why trust this?

The server is a blob store. It never sees the master password, vault key, or plaintext entries. You can check that claim against public specs and tests instead of a marketing page:

- What the **running** backend + PWA actually enforce: [`docs/security-boundary.md`](docs/security-boundary.md)
- Threat model: [`docs/threat-model.md`](docs/threat-model.md)
- Adversarial review of the crypto core: [`docs/adversarial-review.md`](docs/adversarial-review.md)
- AES-256-GCM KATs: [`docs/test-vectors.md`](docs/test-vectors.md)
- Argon2id KATs: [`docs/test-vectors-argon2id.md`](docs/test-vectors-argon2id.md)
- Recovery (no server reset): [`docs/recovery.md`](docs/recovery.md)
- Audit map for a third party: [`docs/audit-scope.md`](docs/audit-scope.md)
- Reproducible PWA / extension tree hash: [`docs/reproducible-builds.md`](docs/reproducible-builds.md)

There is **no** independent third-party audit yet. Planned scope is in `docs/audit-scope.md`. Feature comparison (honest ✅ / ⏳): [`docs/comparison.md`](docs/comparison.md).

## Documentation

- Agent playbook (review / code / improve): [`.cursor/skills/4allpass/SKILL.md`](.cursor/skills/4allpass/SKILL.md)
- Product plan: [`docs/development-plan.md`](docs/development-plan.md)
- Positioning: [`docs/positioning.md`](docs/positioning.md)

- Crypto Protocol v1: [`docs/crypto-protocol.md`](docs/crypto-protocol.md)
- WebAuthn PRF construction: [`docs/webauthn-prf.md`](docs/webauthn-prf.md)
- Vault revision / rotation / snapshot manifest: [`docs/vault-revision.md`](docs/vault-revision.md)
- Recovery Key & Emergency Kit: [`docs/recovery.md`](docs/recovery.md)
- Threat Model: [`docs/threat-model.md`](docs/threat-model.md)
- Adversarial review of the crypto core: [`docs/adversarial-review.md`](docs/adversarial-review.md)
- Security boundary (what is actually implemented): [`docs/security-boundary.md`](docs/security-boundary.md)
- AES-256-GCM Testvektoren: [`docs/test-vectors.md`](docs/test-vectors.md)
- Argon2id Testvektoren: [`docs/test-vectors-argon2id.md`](docs/test-vectors-argon2id.md)
- Post-quantum roadmap (concept only): [`docs/post-quantum-roadmap.md`](docs/post-quantum-roadmap.md)

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
npm run test:e2e:live                    # headed Chrome/Firefox/Brave/WebKit on this Mac
# see docs/live-browser-test.md
npm run build -w @4allpass/extension     # Chromium MV3 unpacked load: extension/dist
# see docs/autofill-extension.md
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
POST     /api/v1/vaults/{id}/webauthn/challenges           # one-time ceremony
POST     /api/v1/vaults/{id}/webauthn/challenges/{id}/consume
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
