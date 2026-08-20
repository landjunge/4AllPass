# Post-quantum roadmap

**Status:** Concept only. Protocol v1 is unchanged.  
**Date:** 2026-08-20  
**Not this document:** an ML-KEM implementation, a `cryptoVersion` bump, or a new envelope type.

Companion: `crypto-protocol.md`, `threat-model.md` §5 (“Quantum attacks on AES”), `webauthn-prf.md`.

---

## 1. What v1 actually uses

Vault confidentiality is **symmetric**:

| Primitive | Role | Quantum note |
|---|---|---|
| AES-256-GCM | Entries, envelopes, sealed manifest | Grover → ~128-bit; NIST still treats AES-256 as the PQ-symmetric default |
| SHA-256 | AAD, HKDF, digests | Same Grover factor; 128-bit security remains the planning number |
| Argon2id | Master-password → Master Key | Not Shor-broken. Offline guessing stays the real server-compromise threat |
| Random 256-bit VK / Recovery Key | Wrapping targets | Grover → ~128-bit. Not derived from a password |
| WebAuthn PRF → HKDF-SHA-256 → DWK | Device unlock | Wrapping stays symmetric. PRF quality is the authenticator’s |
| COSE ES256 (P-256) | Server ceremony verify only | Shor-broken. **Not** used to wrap VK |

There is **no** X25519, RSA, or KEM on the vault path today. Stored snapshots are AES-GCM under a random VK. A cryptographically relevant quantum computer that only runs Shor does not decrypt them.

Harvest-now-decrypt-later against this server therefore does not buy plaintext. The leftover quantum work is Grover on AES-256 / SHA-256 (impractical at 128-bit) or the same Argon2id dictionary attack as classically, slightly cheaper.

---

## 2. What would actually need a hybrid KEM

Hybrid KEM (X25519 + ML-KEM-768, or a successor NIST pick) is only required if 4AllPass **introduces public-key wrapping**. Candidates, none of them in v1:

- Selective sharing that wraps VK (or a per-item key) to another party’s Device Key without a shared master password.
- Enrolling a new device without the master password, using a static PQ public key.
- Any “send this envelope to an identity the server can name.”

Until one of those exists, adding ML-KEM would be a second protocol with no caller. Do not implement it “so the README can say post-quantum.”

WebAuthn COSE (ES256) is ceremony integrity for `cose_verified` rows. If P-256 signatures become worthless, an attacker with a session can more easily plant metadata. They still cannot unwrap VK. Replacing ES256 is a WebAuthn/platform problem (`ML-DSA` / hybrid attestations), not a vault-envelope problem. Track it when authenticators ship it; do not invent a parallel signature scheme in `packages/crypto`.

---

## 3. If public-key wrapping is added

Rules that keep Zero-Knowledge and versioning honest:

1. **New `cryptoVersion`.** v1 clients must refuse the new objects (`ProtocolError`), not ignore extra fields.
2. **Hybrid, not PQ-only.** Classical ECDH/X25519 (or equivalent) in parallel with ML-KEM until the classical half is retired on a later version.
3. **KEM wraps a random key, never VK derived from the KEM secret.** Same invariant as today: VK is random; envelopes wrap it.
4. **AAD binds algorithm ids, both public keys, and `vaultKeyVersion`.** A server that swaps the ML-KEM blob for an X25519-only blob must fail closed.
5. **KATs and an `adversarial-kdf-prf` (or new `adversarial-kem`) class** in the same PR as the library code. No silent “we’ll add vectors later.”
6. **Sharing UI is still later.** A KEM envelope is not “Eintrag teilen in 2 Klicks.” Do not land one without the other unless the spec explicitly ships storage-only.

Suggested (not implemented) envelope sketch, for when that PR exists:

```
type: "kem"
kem: "x25519+ml-kem-768"
encapsulated: { classical, mlkem }   // opaque ciphertext
nonce / ciphertext / tag             // AES-256-GCM of VK under the shared wrapping key
```

The wrapping key is `HKDF(IKM = ss_classical || ss_mlkem, …)` with a new label. The server stores the blob. It never sees `ss_*` or VK.

---

## 4. Triggers to reopen this file

- A feature that wraps keys to a public identity (sharing, remote enrol).
- NIST or browser-platform deprecation that actually affects AES-256-GCM or WebAuthn PRF.
- A v2 protocol bump for another reason, at which point hybrid KEM can ride along if sharing is in scope.

Until then the honest line is: **v1 is symmetric Zero-Knowledge; quantum does not change the threat model’s “malicious server sees ciphertext.”** Offline Argon2id remains the attack to worry about.

No code in this repository implements ML-KEM or X25519 vault wrapping.
