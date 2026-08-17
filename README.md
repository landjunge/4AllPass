# 4AllPass

Self-hosted Zero-Knowledge Password Manager – for all browsers and devices.

Selektives Profil-Sharing, Argon2id, WebAuthn-Biometrie, PWA.

- Architektur: [`docs/architecture.md`](docs/architecture.md)
- Crypto Protocol v1: [`docs/crypto-protocol.md`](docs/crypto-protocol.md)
- Threat Model: [`docs/threat-model.md`](docs/threat-model.md)
- AES-256-GCM Testvektoren: [`docs/test-vectors.md`](docs/test-vectors.md)
- Argon2id Testvektoren: [`docs/test-vectors-argon2id.md`](docs/test-vectors-argon2id.md)

```sh
node scripts/verify-aes-gcm-vectors.mjs
pip install -r scripts/requirements-dev.txt
python3 scripts/verify-argon2id-vectors.py
```
