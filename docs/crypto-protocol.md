# 4AllPass Crypto Protocol v1

**Status:** Draft – Security Specification  
**Date:** 2026-08-17  
**Applies to:** 4AllPass Self-hosted Zero-Knowledge Password Manager

This document is the authoritative cryptographic specification for 4AllPass.  
All implementations (Web, Extension, PWA, future Mobile) **must** follow this protocol exactly.  
`docs/architecture.md` provides the high-level system overview; this document defines the concrete crypto rules.

AES-256-GCM known-answer tests (including the canonical AAD encoding) live in **[docs/test-vectors.md](test-vectors.md)**.

---

The specification is split into focused modules. **Section numbers are unchanged**:
`crypto-protocol.md` §N still names the same rule. Module text is the previous
single-file content.

| § | Topic | Module |
|---|---|---|
| 1 | Goals & Hard Invariants | [`crypto/invariants.md`](crypto/invariants.md) |
| 2 | Key Hierarchy | [`crypto/key-hierarchy.md`](crypto/key-hierarchy.md) |
| 3 | KeyEnvelope Format (versioned) | [`crypto/envelopes.md`](crypto/envelopes.md) |
| 4 | Master Password Flow | [`crypto/key-derivation.md`](crypto/key-derivation.md) |
| 5 | Device Model & WebAuthn | [`crypto/authentication.md`](crypto/authentication.md) |
| 6 | Recovery | [`crypto/recovery.md`](crypto/recovery.md) |
| 7 | Device Lifecycle & Revocation | [`crypto/revocation.md`](crypto/revocation.md) |
| 8 | Entry Encryption | [`crypto/encryption.md`](crypto/encryption.md) |
| 8.1–8.3 | Snapshot Manifest & Integrity | [`crypto/snapshot-integrity.md`](crypto/snapshot-integrity.md) |
| 9 | Serialization, Versioning & Future Migration | [`crypto/versioning.md`](crypto/versioning.md) |
| 10 | Memory & Lock Lifecycle | [`crypto/lock-lifecycle.md`](crypto/lock-lifecycle.md) |
| 11 | What the Server Is Allowed to Store | [`crypto/server-storage.md`](crypto/server-storage.md) |
| 12 | Test Requirements (Crypto Core) | [`crypto/testing.md`](crypto/testing.md) |
| 13 | Relationship to Other Documents | this file |

---

## 13. Relationship to Other Documents

| Document                  | Responsibility                                      |
|---------------------------|-----------------------------------------------------|
| `architecture.md`         | High-level system design & product goals            |
| **`crypto-protocol.md`**  | **This document – authoritative crypto rules**      |
| **`packages/crypto`**     | **Reference TypeScript implementation of this spec** |
| `threat-model.md`         | Attackers, assets, **malicious server**, residual risks |
| **`adversarial-review.md`** | **Attack-driven review of `packages/crypto`: findings, fixes, residual risks** |
| **`webauthn-prf.md`**     | **PRF → HKDF → DWK → DK construction + fallback**   |
| **`vault-revision.md`**   | **Snapshots, rollback detection, atomic rotation**  |
| **`test-vectors.md`**     | **AES-256-GCM known-answer tests + AAD encoder**    |
| **`test-vectors-argon2id.md`** | **Argon2id known-answer tests + KDF profiles** |
| `test-vectors/device-prf-v1.json` | PRF / HKDF / Device-Key Envelope KATs     |
| **`recovery.md`**         | **Recovery Key encoding, RWK derivation, Emergency Kit** |
| `device-management.md`    | Device identity, registration UX, revocation flows  |

---

**Crypto Protocol v1 – End of Specification**

This document is intentionally strict.  
Any implementation that cannot satisfy the invariants above is not compliant with 4AllPass Crypto Protocol v1.

