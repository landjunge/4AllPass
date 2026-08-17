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

```sh
npm test
npm run test:crypto:heavy   # includes 32–128 MiB Argon2id profiles
node scripts/verify-aes-gcm-vectors.mjs
pip install -r scripts/requirements-dev.txt
python3 scripts/verify-argon2id-vectors.py
```
