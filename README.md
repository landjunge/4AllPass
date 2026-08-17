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
- Database schema: [`docs/db-schema.md`](docs/db-schema.md)
- Threat model: [`docs/threat-model.md`](docs/threat-model.md)
- AES-256-GCM vectors: [`docs/test-vectors.md`](docs/test-vectors.md)
- Argon2id vectors: [`docs/test-vectors-argon2id.md`](docs/test-vectors-argon2id.md)

## Key path

```
Master password ──Argon2id──► Master Key ──unwraps──► Master Envelope ──► Vault Key
Recovery Key ─────────────────────────────unwraps──► Recovery Envelope ─► Vault Key
WebAuthn assertion + PRF ──HKDF──► DWK ──unwraps──► Device-Key Envelope ─► Device Key
                                                    Device Envelope ─────► Vault Key
```

The Vault Key is always random, never derived from a password. PRF output and
the DWK are never used as keys and are zeroized immediately after use. Master
password unlock stays available on every device.

## Run everything

```sh
docker compose up --build       # web on http://localhost:8080
```

Local development:

```sh
npm install
npm test                        # crypto + webauthn suites
npm run typecheck

cd backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload

npm run dev -w @4allpass/web    # http://localhost:5173
```

```sh
npm run test:crypto:heavy       # includes the 32–128 MiB Argon2id profiles
node scripts/verify-aes-gcm-vectors.mjs
pip install -r scripts/requirements-dev.txt
python3 scripts/verify-argon2id-vectors.py
```

`backend/.venv/bin/pytest` needs PostgreSQL and Redis; it runs the real Alembic
migration and uses the `_test` database plus Redis DB 1.
