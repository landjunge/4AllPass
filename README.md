# 4AllPass

<p align="center"><img src="frontend/public/logo.png" alt="4AllPass — magpie with a gold key" width="420" /></p>

**Secure credential access for humans, applications and AI agents.**

Your agents need access. They don't need your secrets.

```text
Human / App / Agent → request → Policy → allow / deny → scoped credential → Provider
```

Not “a nicer Bitwarden.” Devices still own the vault cryptographically. The **wedge** is agent credential access — 8-week plan: [`docs/eight-week-agent-access.md`](docs/eight-week-agent-access.md). The Access tab has a local [two-minute demo](docs/two-minute-demo.md). Optional loopback broker for a foreign process: [`docs/local-access-broker.md`](docs/local-access-broker.md) (`npm run broker`, pairing token, not FastAPI). Launch note: [Your AI Agent Doesn't Need Your API Keys](docs/your-ai-agent-doesnt-need-your-api-keys.md). FastAPI still never mints tokens. There is no n8n marketplace node.

Today: self-hosted Zero-Knowledge vault, Argon2id, WebAuthn device unlock, PWA, Chromium/Firefox/macOS Safari fill. Item share is an encrypted file plus share key; the server never sees either. Wrapping to someone else’s device key is not in v1. See [`docs/positioning.md`](docs/positioning.md).

## Layout

| Path | What it is |
|---|---|
| [`packages/crypto`](packages/crypto) | `@4allpass/crypto` — Crypto Protocol v1 core. No UI, no network, no authenticator I/O |
| [`packages/webauthn`](packages/webauthn) | `@4allpass/webauthn` — device unlock: PRF > largeBlob > UV-gated local store |
| [`backend`](backend) | FastAPI + PostgreSQL + Redis. Account-Session, Ownership, Snapshot-CAS. Stores opaque envelopes only |
| [`frontend`](frontend) | React + TypeScript PWA. All cryptography happens here |
| [`extension`](extension) | Chromium + Firefox MV3 + macOS Safari autofill. Decrypts on-device via `@4allpass/crypto` |
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
- Positioning (current claims): [`docs/positioning.md`](docs/positioning.md)
- 8-week agent-access plan: [`docs/eight-week-agent-access.md`](docs/eight-week-agent-access.md)
- Two-minute Access demo: [`docs/two-minute-demo.md`](docs/two-minute-demo.md)
- Local loopback broker (optional, not FastAPI): [`docs/local-access-broker.md`](docs/local-access-broker.md)
- Launch article: [`docs/your-ai-agent-doesnt-need-your-api-keys.md`](docs/your-ai-agent-doesnt-need-your-api-keys.md)
- Launch post drafts: [`docs/launch-posts.md`](docs/launch-posts.md)
- Target category (not current): [`docs/positioning-target.md`](docs/positioning-target.md)

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
- Selective item share (encrypted file, v1): [`docs/sharing.md`](docs/sharing.md)
- Provider & service management (concept only, far later): [`docs/provider-service-vision.md`](docs/provider-service-vision.md)
- Secret Access Layer (concept only, far later): [`docs/secret-access-layer.md`](docs/secret-access-layer.md)
- Capability interface with Tollgate / Gnom-Hub (concept only, far later): [`docs/capability-interface.md`](docs/capability-interface.md)
- Capability contract 4AP-CAP-1 (concept only, not a protocol): [`docs/capability-contract-v1.md`](docs/capability-contract-v1.md)

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
npm run build -w @4allpass/extension     # unpacked: Chrome/Firefox; macOS Safari: open extension/safari/FourAllPass/FourAllPass.xcodeproj
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
