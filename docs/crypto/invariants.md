## 1. Goals & Hard Invariants

### Goals
- True Zero-Knowledge: The server never sees plaintext passwords, the Master Password, the Vault Key, or any recoverable key material that would allow decryption without the user’s secrets.
- Cryptographic device authorization (not just flags).
- Safe recovery path without weakening Zero-Knowledge.
- Forward-compatible versioning.
- Minimal attack surface on full server compromise (only expensive offline attacks remain).

### Hard Invariants (never violate)
1. The **Vault Key is always pure random** (never derived from the Master Password).
2. AES-256-GCM nonces are **never reused** with the same key. Nonce generation is owned exclusively by the crypto library.
3. Every encryption operation uses **Associated Authenticated Data (AAD)** encoded as specified in §3.1.
4. The Master Password **never leaves the client** and is zeroized as soon as possible after key derivation.
5. Social Login / OAuth / Account Password have **zero influence** on vault decryption.
6. Crypto version is present on every envelope and every encrypted entry.
7. **Versions are never defaulted.** `vaultKeyVersion`, `deviceKeyVersion`, `schemaVersion` and `cryptoVersion` are always stated explicitly by the writer and read back from the object.
8. **Every field of an envelope or entry is authenticated.** Any metadata that is not covered by AAD (or by the manifest of §8.1) must be rejected, never ignored.
9. **Opening is always done against an expectation.** AAD built from the object's own fields proves self-consistency, not identity: the caller states which vault, which entry, which device and which key generation it intends to open, and a mismatch is an error before decryption.
10. **`revision` is only trustworthy after the manifest verifies** (§8.1). A revision number that was merely asserted by the server must never be pinned.

---
