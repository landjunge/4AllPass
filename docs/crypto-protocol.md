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
    hashLen: 32;                                 // Master Key bytes
    salt: Uint8Array;                            // 16 or 32 bytes
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

The `crypto_version` field in AAD **must** be the `version` stored on that same envelope.  
Implementations must pass `envelope.version` into `envelopeAad(...)` on wrap and unwrap. A library-wide default is not acceptable: it would allow `envelope.version = 2` to be sealed under AAD `crypto_version = 1`.

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
- Hash length: **32 bytes**
- Version: **0x13** (19)
- Secret (K) and associated data (X): **empty**
- Password encoding: Unicode **NFC**, then UTF-8

| Profile | Memory | t | p | Production |
|---------|-------:|--:|--:|------------|
| `ci` | 32 KiB | 3 | 4 | **No** — tests only |
| `mobile_safe` | 32 MiB | 3 | 1 | Yes |
| `balanced` | 32 MiB | 6 | 4 | Yes |
| **`standard`** (default) | **64 MiB** | **3** | **4** | Yes |
| `high` | 128 MiB | 4 | 4 | Yes |

`standard` is RFC 9106 SECOND RECOMMENDED memory. `ci` MUST NOT be persisted on a production vault.  
Chosen parameters **must** be stored inside the Master Envelope so that later re-keying is possible without data loss.

Known-answer tests: **[docs/test-vectors-argon2id.md](test-vectors-argon2id.md)**.

---

## 5. Device Model & WebAuthn

WebAuthn / Passkeys are a **platform-protected unlock trigger** and the preferred source of the Device Wrapping Key.  
They are **not** an encryption oracle for the Vault Key.

The byte-level construction (PRF input, HKDF salt/info, Device-Key Envelope, fallback ranking) lives in **[docs/webauthn-prf.md](webauthn-prf.md)**. That document is authoritative. A short summary:

1. After Master-Password unlock, generate a random 256-bit **Device Key (DK)**.
2. Derive **DWK = HKDF-SHA-256(PRF output, …)** — never use raw PRF output as a key.
3. Wrap DK under DWK (Device-Key Envelope, local).
4. Wrap VK under DK (Device Envelope, server).
5. On biometric unlock: assertion → PRF → DWK → DK → VK.

Fallback to Master Password must always remain possible.  
Do not implement a custom “WebAuthn → Device Key” shortcut.

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

**Required procedure – Vault Key Rotation:** see **[docs/vault-revision.md](vault-revision.md)**.

Summary: produce a complete new snapshot at `revision N+1` with `vault_key_version + 1`, re-encrypt every entry, mint a full new envelope set, then CAS `active_revision`. Never mix VK₁ entries with VK₂ envelopes.

Implementations **must** support Vault Key Rotation and must refuse rolled-back revisions (`evaluateRevision`).

---

## 8. Entry Encryption

### EncryptedEntry
```ts
interface EncryptedEntry {
  id: string;                 // stable entry identifier
  schemaVersion: number;      // plaintext JSON schema; stored, never guessed
  cryptoVersion: number;      // crypto protocol version used to seal this entry
  nonce: Uint8Array;          // 12 bytes
  ciphertext: Uint8Array;     // raw GCM ciphertext (no tag)
  tag: Uint8Array;            // 16-byte auth tag
}
```

`decryptEntry(entry, vaultKey, vaultId)` reads `schemaVersion` and `cryptoVersion` **from the entry**.  
The caller does not pass them. That is what keeps a v2 payload decryptable after a schema bump.

### Rules
- Public library API must **not** accept a caller-supplied nonce.
- Nonce is always generated inside the library (`crypto.getRandomValues` or equivalent CSPRNG).
- A test-only hook may accept a nonce solely to reproduce [docs/test-vectors.md](test-vectors.md).
- Mandatory AAD for every entry encryption, using the encoder in §3.1:

  ```
  "4allpass-entry-v1" || vault_id || entry_id || schema_version_u32be || crypto_version_u32be
  ```

  Both version integers in the AAD are the values stored on that same `EncryptedEntry`.

- Plaintext is only ever present on the client after successful unlock.

Worked hex: **TV-ENTRY-01**. Cross-vault rejection: **TV-TAMPER-CROSS-VAULT**.

---

## 9. Serialization, Versioning & Future Migration

- Every KeyEnvelope carries `version: 1` (crypto protocol).
- Every EncryptedEntry carries `cryptoVersion: 1` and a `schemaVersion` of its plaintext.
- The vault snapshot records `crypto_protocol_version`, `revision`, and `vault_key_version` — see [vault-revision.md](vault-revision.md).
- Future protocol changes (new KDF, new AAD schema, new algorithms) will increment the crypto version and provide a migration path.
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
- Vault metadata (`vault_id`, creation time, `crypto_protocol_version`, `revision`, `vault_key_version`)
- Immutable snapshots (envelopes + entries) and the `active_revision` pointer
- Device metadata (`deviceId`, user-agent summary, last seen, WebAuthn credential IDs)
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
  Run: `node scripts/verify-aes-gcm-vectors.mjs` or `npm test` (`@4allpass/crypto`)
- **Argon2id known-answer tests** in [docs/test-vectors-argon2id.md](test-vectors-argon2id.md) / [`docs/test-vectors/argon2id-v1.json`](test-vectors/argon2id-v1.json)  
  Run: `npm test` (skips 32–128 MiB unless `RUN_HEAVY=1`) or `python3 scripts/verify-argon2id-vectors.py`
- Property-based tests (random keys, random plaintexts)
- Tampering tests (modified ciphertext, modified AAD, wrong nonce → authentication failure) — covered by `TV-TAMPER-*`
- Wrong-password / wrong-recovery-key tests
- Nonce uniqueness under concurrent encryption
- Revision rollback / vault-key downgrade (`evaluateRevision`)
- Device-PRF HKDF + Device-Key Envelope (`device-prf-v1.json`)
- Key rotation end-to-end test (full snapshot commit)
- Soft + hard revocation tests
- Cross-device envelope isolation tests

---

## 13. Relationship to Other Documents

| Document                  | Responsibility                                      |
|---------------------------|-----------------------------------------------------|
| `architecture.md`         | High-level system design & product goals            |
| **`crypto-protocol.md`**  | **This document – authoritative crypto rules**      |
| **`packages/crypto`**     | **Reference TypeScript implementation of this spec** |
| `threat-model.md`         | Attackers, assets, **malicious server**, residual risks |
| **`webauthn-prf.md`**     | **PRF → HKDF → DWK → DK construction + fallback**   |
| **`vault-revision.md`**   | **Snapshots, rollback detection, atomic rotation**  |
| **`test-vectors.md`**     | **AES-256-GCM known-answer tests + AAD encoder**    |
| **`test-vectors-argon2id.md`** | **Argon2id known-answer tests + KDF profiles** |
| `test-vectors/device-prf-v1.json` | PRF / HKDF / Device-Key Envelope KATs     |
| `recovery.md`             | Detailed Emergency Kit UX & operational guidance    |
| `device-management.md`    | Device identity, registration UX, revocation flows  |

---

**Crypto Protocol v1 – End of Specification**

This document is intentionally strict.  
Any implementation that cannot satisfy the invariants above is not compliant with 4AllPass Crypto Protocol v1.
