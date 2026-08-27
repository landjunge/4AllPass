## 12. Test Requirements (Crypto Core)

Before any production use the following must pass:

- **AES-256-GCM known-answer tests** in [docs/test-vectors.md](../test-vectors.md) / [`docs/test-vectors/aes-gcm-v1.json`](../test-vectors/aes-gcm-v1.json)  
  Run: `node scripts/verify-aes-gcm-vectors.mjs` or `npm test` (`@4allpass/crypto`)
- **Argon2id known-answer tests** in [docs/test-vectors-argon2id.md](../test-vectors-argon2id.md) / [`docs/test-vectors/argon2id-v1.json`](../test-vectors/argon2id-v1.json)  
  Run: `npm test` (skips 32–128 MiB unless `RUN_HEAVY=1`) or `python3 scripts/verify-argon2id-vectors.py`
- **Manifest and recovery vectors** in [`docs/test-vectors/recovery-v1.json`](../test-vectors/recovery-v1.json) and the `TV-MANIFEST-*` entries of `aes-gcm-v1.json`
- Property-based tests (random keys, random plaintexts)
- Tampering tests (modified ciphertext, modified AAD, wrong nonce → authentication failure) — covered by `TV-TAMPER-*`
- Wrong-password / wrong-recovery-key tests
- Nonce uniqueness under concurrent encryption
- Revision rollback / vault-key downgrade (`evaluateRevision`)
- Device-PRF HKDF + Device-Key Envelope (`device-prf-v1.json`)
- Key rotation end-to-end test (full snapshot commit)
- Soft + hard revocation tests
- Cross-device envelope isolation tests

### Adversarial suite (mandatory)

Known-answer tests prove the construction; they do not prove that the API refuses
abuse. `packages/crypto/test/adversarial-*.test.ts` covers, one test group per class:

```
nonce reuse            version confusion      AAD mismatch
cross-vault            cross-device           key substitution
downgrade              rollback               malformed input
truncation             credential swapping    PRF misuse
HKDF misuse            zeroization leaks      test-only API leakage
```

Findings, decisions and residual risks: **[docs/adversarial-review.md](../adversarial-review.md)**.

---
