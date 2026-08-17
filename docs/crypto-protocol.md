# 4AllPass Crypto Protocol v1

**Status:** Draft – Security Specification  
**Date:** 2026-08-17  
**Applies to:** 4AllPass Self-hosted Zero-Knowledge Password Manager

This document is the authoritative cryptographic specification for 4AllPass.  
All implementations (Web, Extension, PWA, future Mobile) **must** follow this protocol exactly.  
`docs/architecture.md` provides the high-level system overview; this document defines the concrete crypto rules.

AES-256-GCM known-answer tests (including the canonical AAD encoding) live in **[docs/test-vectors.md](test-vectors.md)**.

---

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

---

## 2. Key Hierarchy

```
                    Random 256-bit Vault Key (VK)
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
  Master Envelope       Device Envelopes       Recovery Envelope
  (Argon2id → MK)       (Device Key Material)  (Recovery Key)
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              │
                              ▼
                     AES-256-GCM + AAD
                     (Vault Entries)
```

### Key Definitions

| Key                    | Type                  | Lifetime / Scope                  | Purpose                                      |
|------------------------|-----------------------|-----------------------------------|----------------------------------------------|
| **Vault Key (VK)**     | Random 256-bit        | Per vault, until rotation         | Encrypts all vault entries                   |
| **Master Key (MK)**    | Argon2id output       | Ephemeral (derived on unlock)     | Unwraps the Master Envelope                  |
| **Device Key Material**| Platform-protected    | Per registered device             | Unwraps the corresponding Device Envelope    |
| **Recovery Key**       | Random high-entropy   | Long-term offline (Emergency Kit) | Unwraps the Recovery Envelope                |

The Vault Key is generated once when the vault is created.  
It is **never** derived from any password.

---

## 3. KeyEnvelope Format (versioned)

Every way to obtain the Vault Key is represented as a **KeyEnvelope**.

```ts
interface KeyEnvelope {
  version: 1;                                    // crypto protocol version
  type: "master" | "device" | "recovery";

  // Present only when type === "master"
  kdf?: {
    algorithm: "argon2id";
    version: 0x13;                               // Argon2 version identifier
    memory: number;                              // KiB
    iterations: number;
    parallelism: number;
    salt: Uint8Array;                            // 16–32 bytes recommended
  };

  // Present only when type === "device"
  deviceId?: string;                             // stable device/profile identifier

  // Common fields
  encryption: "AES-256-GCM";
  nonce: Uint8Array;                             // 12 bytes, library-generated
  ciphertext: Uint8Array;                        // raw GCM ciphertext (no tag)
  tag: Uint8Array;                               // 16-byte auth tag
}
```

Storage / WebCrypto concatenation is `ciphertext || tag` (tag last). Test vectors list the two fields separately.

### 3.1 Canonical AAD encoding

Naive concatenation of variable-length strings is **forbidden** (it is ambiguous).  
v1 AAD is a sequence of length-prefixed fields:

```
field  = uint16be(byte_length) || bytes
AAD    = field+
```

- Strings are UTF-8 without a trailing NUL.
- Integer versions are encoded as **uint32be** (4 bytes), then length-prefixed (`len = 4`).
- An absent optional string is an empty field (`len = 0`).

**Envelope AAD** (exact order):

```
"4allpass-envelope-v1" || vault_id || type || crypto_version_u32be || device_id_or_empty
```

This binds the envelope to a specific vault and prevents cross-vault or type-confusion attacks.

Worked hex and encrypt/decrypt known-answer tests: **[docs/test-vectors.md](test-vectors.md)** (`TV-ENV-*`, `TV-TAMPER-TYPE`).

---

## 4. Master Password Flow

1. User enters Master Password.
2. Client loads the Master Envelope (contains salt + Argon2 parameters).
3. Client derives `MK = Argon2id(MasterPassword, salt, memory, iterations, parallelism)`.
4. Client attempts to decrypt the Master Envelope with MK + correct AAD.
5. On success → Vault Key is obtained → vault is unlocked.
6. Master Password and intermediate key material are zeroized as soon as practical.

**Recommended default Argon2id parameters (v1):**
- Memory: 64 MiB (65536 KiB)
- Iterations: 3
- Parallelism: 4

Profiles (Standard / Balanced / Mobile-safe / High) may be offered, but the chosen parameters **must** be stored inside the Master Envelope so that later re-keying is possible without data loss.

---

## 5. Device Model & WebAuthn

### Design Principle
WebAuthn / Passkeys are used as a **platform-protected unlock trigger** and as protection for Device Key Material.  
They are **not** treated as a general-purpose encryption oracle for the Vault Key.

### Recommended v1 approach
1. After successful Master-Password unlock, generate a random 256-bit **Device Key**.
2. Protect this Device Key using the best available platform capability:
   - Preferred: WebAuthn PRF extension (where supported).
   - Fallback: Authenticator-bound secret + local encrypted storage that is only released after a successful WebAuthn assertion.
3. The Device Key wraps the Vault Key → produces a **Device Envelope**.
4. The Device Envelope is uploaded to the server and associated with the device identity.

### Unlock with Biometrics
1. Perform WebAuthn assertion (user presence / biometric).
2. Obtain / unlock the Device Key Material.
3. Unwrap the Device Envelope → obtain Vault Key.
4. Proceed to decrypt entries.

Fallback to Master Password must always remain possible.

---

## 6. Recovery

### Primary Recovery Mechanism (v1)
**Recovery Key** (recommended and required for production vaults)

- Generated once at vault creation (cryptographically random, ≥ 256 bit entropy).
- Encoded for humans (BIP39 24-word style **or** high-entropy Base58).
- Creates a **Recovery Envelope** (type = `"recovery"`).
- Presented to the user as an **Emergency Kit** (printable + QR):
  - Vault ID
  - Recovery words / code
  - Clear warning that this is the **only** recovery path
  - Instruction to store offline and securely

### Explicit Non-Goals for v1
- No e-mail / “forgot password” reset that restores vault access.
- No social-login-based recovery.
- No server-side recovery of the Vault Key.

### Recovery Flow
1. User provides Recovery Key.
2. Client unwraps Recovery Envelope → obtains Vault Key.
3. User can then create a new Master Envelope and/or new Device Envelopes.

Later versions may add Shamir Secret Sharing as an optional advanced recovery method.

---

## 7. Device Lifecycle & Revocation

### Adding a new device
1. Unlock the vault (Master Password or Recovery Key).
2. (Optional) Register WebAuthn credential and create Device Key Material.
3. Create new Device Envelope.
4. Upload Device Envelope to server.

### Soft Revocation (device not believed compromised)
- Server simply deletes / disables the Device Envelope.
- The device can no longer obtain the Vault Key via sync.

### Hard Revocation (device may be compromised)
Because a compromised device already knows the current Vault Key, soft revocation is insufficient.

**Required procedure – Vault Key Rotation:**
1. Generate a new random Vault Key (`VK_v2`).
2. Re-encrypt **all** vault entries under `VK_v2` (new nonces, same AAD rules + updated key version).
3. Create fresh Envelopes (Master, Recovery, and all remaining trusted devices) that wrap `VK_v2`.
4. Atomically replace the old envelopes + old encrypted entries on the server.
5. Old devices that still possess `VK_v1` can no longer decrypt the new vault data.

Implementations **must** support Vault Key Rotation.

---

## 8. Entry Encryption

### EncryptedEntry
```ts
interface EncryptedEntry {
  id: string;                 // stable entry identifier
  version: number;            // schema / crypto version
  nonce: Uint8Array;          // 12 bytes
  ciphertext: Uint8Array;     // raw GCM ciphertext (no tag)
  tag: Uint8Array;            // 16-byte auth tag
}
```

### Rules
- Public library API must **not** accept a caller-supplied nonce.
- Nonce is always generated inside the library (`crypto.getRandomValues` or equivalent CSPRNG).
- A test-only hook may accept a nonce solely to reproduce [docs/test-vectors.md](test-vectors.md).
- Mandatory AAD for every entry encryption, using the encoder in §3.1:

  ```
  "4allpass-entry-v1" || vault_id || entry_id || schema_version_u32be || crypto_version_u32be
  ```

- Plaintext is only ever present on the client after successful unlock.

Worked hex: **TV-ENTRY-01**. Cross-vault rejection: **TV-TAMPER-CROSS-VAULT**.

---

## 9. Serialization, Versioning & Future Migration

- Every KeyEnvelope and every EncryptedEntry carries `version: 1`.
- The vault root object also records `crypto_protocol_version: 1`.
- Future protocol changes (new KDF, new AAD schema, new algorithms) will increment the version and provide a migration path.
- KDF parameters live inside the Master Envelope so that the client can always re-derive the correct Master Key even after a profile upgrade.

---

## 10. Memory & Lock Lifecycle

### State Machine
```
LOCKED  →  UNLOCKING  →  UNLOCKED  →  LOCKING  →  LOCKED
```

### Rules
- Master Password exists in memory only during the short derivation window, then is zeroized.
- Vault Key and all plaintext entry data exist only in the `UNLOCKED` state.
- On any transition to `LOCKED` (manual lock, auto-lock, tab hidden, extension closed, app backgrounded) all sensitive material must be zeroized as thoroughly as the platform allows.

**Note:** JavaScript / WASM environments cannot provide perfect memory erasure guarantees. This is documented in the threat model and accepted as a platform limitation.

### Recommended Auto-Lock Triggers
- Configurable inactivity timeout
- Document / tab visibility change (`visibilitychange`)
- Extension popup closed
- Mobile app backgrounded

---

## 11. What the Server Is Allowed to Store

The server may store:
- Account authentication data (email, account password hash, OAuth identifiers)
- Vault metadata (vault_id, creation time, crypto_protocol_version)
- KeyEnvelopes (ciphertext only)
- EncryptedEntries (ciphertext only)
- Device metadata (deviceId, user-agent summary, last seen, WebAuthn credential IDs)
- Salts and Argon2 parameters (they live inside the Master Envelope)

The server must **never** store:
- Master Password
- Vault Key in plaintext
- Any key that can decrypt the vault without user secrets
- Plaintext entry data

---

## 12. Test Requirements (Crypto Core)

Before any production use the following must pass:

- **AES-256-GCM known-answer tests** in [docs/test-vectors.md](test-vectors.md) / [`docs/test-vectors/aes-gcm-v1.json`](test-vectors/aes-gcm-v1.json)  
  Run: `node scripts/verify-aes-gcm-vectors.mjs`
- Known-answer / test-vector tests for Argon2id wrapping (separate file, not yet published)
- Property-based tests (random keys, random plaintexts)
- Tampering tests (modified ciphertext, modified AAD, wrong nonce → authentication failure) — covered by `TV-TAMPER-*`
- Wrong-password / wrong-recovery-key tests
- Nonce uniqueness under concurrent encryption
- Key rotation end-to-end test
- Soft + hard revocation tests
- Cross-device envelope isolation tests

---

## 13. Relationship to Other Documents

| Document                  | Responsibility                                      |
|---------------------------|-----------------------------------------------------|
| `architecture.md`         | High-level system design & product goals            |
| **`crypto-protocol.md`**  | **This document – authoritative crypto rules**      |
| `threat-model.md`         | Attackers, assets, assumptions, residual risks      |
| **`test-vectors.md`**     | **AES-256-GCM known-answer tests + AAD encoder**    |
| `recovery.md`             | Detailed Emergency Kit UX & operational guidance    |
| `device-management.md`    | Device identity, registration UX, revocation flows  |

---

**Crypto Protocol v1 – End of Specification**

This document is intentionally strict.  
Any implementation that cannot satisfy the invariants above is not compliant with 4AllPass Crypto Protocol v1.
