# Adversarial Code Review — `packages/crypto` (v1)

**Scope:** every file under `packages/crypto/src`, reviewed as an attacker with a
malicious server and a hostile local store, not as a reader of the specification.
**Date:** 2026-08-17
**Companions:** `crypto-protocol.md`, `vault-revision.md`, `webauthn-prf.md`, `recovery.md`, `threat-model.md`
**Boundaries (extension / broker / CAS / WebAuthn / loopback):** [`adversarial-review-boundaries.md`](adversarial-review-boundaries.md) (2026-08-25)
**External pass 01 (manifest KDF, nonce policy, native import):** [`adversarial-review-external-01.md`](adversarial-review-external-01.md) (2026-08-26)

The method was deliberately not "read the spec and check the code against it".
Every finding below was first **reproduced as a working attack** against the
implementation, then fixed, then pinned by a test that fails if the fix is
reverted. The tests are grouped by attack class so the mapping is checkable:

| File | Attack classes |
|---|---|
| `test/adversarial-aead.test.ts` | nonce reuse, AAD/digest ambiguity, AAD mismatch, truncation, malformed input, zeroization leaks, test-only API leakage |
| `test/adversarial-identity.test.ts` | entry substitution, cross-vault, cross-device, credential swapping, key substitution, version confusion |
| `test/adversarial-freshness.test.ts` | rollback, snapshot mix-and-match, truncation/injection of records, revoked-device replay, equivocation, key-generation downgrade, pin poisoning |
| `test/adversarial-kdf-prf.test.ts` | PRF misuse, HKDF misuse, KDF parameter downgrade and resource exhaustion |
| `test/adversarial-toctou.test.ts` | time-of-check/time-of-use on records and the KDF block, identifier collisions through ill-formed UTF-16, pin desynchronization, hostile container shapes, error taxonomy |

---

The review is split into focused modules. Finding numbers (F-01 … F-23) are unchanged.

| Module | Contents |
|---|---|
| [`reviews/attack-vectors.md`](reviews/attack-vectors.md) | §1 Findings (F-01–F-23), including second and third pass |
| [`reviews/threat-model.md`](reviews/threat-model.md) | §2 Checked and found sound · §3 Residual risks |
| [`reviews/mitigations.md`](reviews/mitigations.md) | §4 Spec changes · §5 Reconciliation with `main` |

Companion product threat model (not this review): [`threat-model.md`](threat-model.md).
