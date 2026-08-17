# 4AllPass

Self-hosted Zero-Knowledge Password Manager – for all browsers and devices.

Selektives Profil-Sharing, Argon2id, WebAuthn-Biometrie, PWA.

```
apps/api          FastAPI + PostgreSQL + Redis (opaque envelopes only)
apps/web          React + TypeScript PWA
packages/crypto   Crypto Protocol v1 (WebAuthn PRF → HKDF → DWK → DK)
docs/             architecture, crypto, WebAuthn PRF, revisions, vectors
```

- Architektur: [`docs/architecture.md`](docs/architecture.md)
- Crypto Protocol v1: [`docs/crypto-protocol.md`](docs/crypto-protocol.md)
- WebAuthn PRF construction: [`docs/webauthn-prf.md`](docs/webauthn-prf.md)
- Vault revision / rotation: [`docs/vault-revision.md`](docs/vault-revision.md)
- Threat Model: [`docs/threat-model.md`](docs/threat-model.md)
- Crypto core: [`packages/crypto`](packages/crypto)
- API / Device Envelope schema: [`apps/api`](apps/api)
- AES-256-GCM Testvektoren: [`docs/test-vectors.md`](docs/test-vectors.md)
- Argon2id Testvektoren: [`docs/test-vectors-argon2id.md`](docs/test-vectors-argon2id.md)

```sh
npm test
npm run test:crypto:heavy   # includes 32–128 MiB Argon2id profiles
npm run typecheck
node scripts/verify-aes-gcm-vectors.mjs
pip install -r scripts/requirements-dev.txt
python3 scripts/verify-argon2id-vectors.py

python3 -m venv apps/api/.venv
apps/api/.venv/bin/pip install -e "apps/api[dev]"
apps/api/.venv/bin/pytest apps/api/tests
```
