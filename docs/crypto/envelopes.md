## 3. KeyEnvelope Format (versioned)

Every way to obtain the Vault Key is represented as a **KeyEnvelope**.

```ts
interface KeyEnvelope {
  version: number;                               // crypto protocol version (1)
  type: "master" | "device" | "recovery";
  vaultKeyVersion: number;                       // which VK generation this envelope wraps

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
  deviceKeyVersion?: number;                     // which DK generation wraps this envelope

  // Common fields
  encryption: "AES-256-GCM";
  nonce: Uint8Array;                             // 12 bytes, library-generated
  ciphertext: Uint8Array;                        // raw GCM ciphertext (no tag), exactly 32 bytes
  tag: Uint8Array;                               // 16-byte auth tag
}
```

Storage / WebCrypto concatenation is `ciphertext || tag` (tag last). Test vectors list the two fields separately.

Fields that do not belong to a kind must be **absent**, and an implementation must
**reject** them if present rather than ignore them:

| Field | master | device | recovery |
|---|---|---|---|
| `kdf` | required | forbidden | forbidden |
| `deviceId` | forbidden | required | forbidden |
| `deviceKeyVersion` | forbidden | required | forbidden |
| `vaultKeyVersion` | required | required | required |

### 3.1 Canonical AAD encoding

Naive concatenation of variable-length strings is **forbidden** (it is ambiguous).  
v1 AAD is a sequence of length-prefixed fields:

```
field  = uint16be(byte_length) || bytes
AAD    = field+
```

- Strings are UTF-8 without a trailing NUL.
- Integer versions are encoded as **uint32be** (4 bytes), then length-prefixed (`len = 4`).
- An absent optional string is an empty field (`len = 0`); an inapplicable version integer is `uint32be(0)`.

**Envelope AAD** (exact order):

```
"4allpass-envelope-v1"
  || vault_id
  || type
  || crypto_version_u32be
  || vault_key_version_u32be
  || device_id_or_empty
  || device_key_version_u32be          // 0 for master / recovery
  || kdf_params_digest_or_empty        // 32 bytes for master, empty otherwise
```

**Entry AAD** (exact order):

```
"4allpass-entry-v1"
  || vault_id || entry_id
  || schema_version_u32be || crypto_version_u32be || vault_key_version_u32be
```

**Device-Key Envelope AAD** (exact order):

```
"4allpass-device-key-v1"
  || vault_id || device_id || credential_id
  || crypto_version_u32be || device_key_version_u32be
```

**Manifest AAD** (exact order, see §8.1):

```
"4allpass-manifest-v1"
  || vault_id || crypto_version_u32be || revision_u32be || vault_key_version_u32be
```

This binds every object to a specific vault, key generation and role, and prevents
cross-vault, cross-device, type-confusion and key-generation-rollback attacks.

The `crypto_version` field in AAD **must** be the `version` stored on that same envelope.  
Implementations must pass `envelope.version` into `envelopeAad(...)` on wrap and unwrap. A library-wide default is not acceptable: it would allow `envelope.version = 2` to be sealed under AAD `crypto_version = 1`.

#### KDF parameter digest

The `kdf` block of a master envelope is authenticated by digest, so cost
parameters and salt cannot be rewritten by whoever stores the envelope:

```
kdf_params_digest = SHA-256(
  frame([ "4allpass-kdf-params-v1", algorithm, argon2_version_u32be,
          memory_kib_u32be, iterations_u32be, parallelism_u32be,
          hash_len_u32be, salt ])
)
```

`frame()` is the uint32be-length-prefixed encoding of §8.1 — not the uint16be AAD
encoding — because digest preimages must be able to cover values longer than
65 535 bytes.

### 3.2 Opening an envelope

Because the AAD is derived from the envelope's own fields, the tag proves only that
those fields were sealed together. The caller must additionally state what it
believes it is opening:

```
unwrapVaultKey(envelope, {
  wrappingKey, vaultId,
  expectType,                 // the kind the caller intends to open
  expectVaultKeyVersion,      // the snapshot's VK generation
  expectDeviceId,             // device envelopes only
  expectDeviceKeyVersion,     // device envelopes only
})
```

A disagreement between expectation and envelope is an integrity failure and must be
reported as such, before decryption.

### 3.3 Nonce budget

Nonces are 96 random bits per seal. The birthday bound for a single key is about
`2^32` seals; a Vault Key must be rotated well before that. This is a policy limit,
not an enforced counter: implementations that seal at high volume (bulk import,
automated writers) must track it.

Worked hex and encrypt/decrypt known-answer tests: **[docs/test-vectors.md](../test-vectors.md)** (`TV-ENV-*`, `TV-TAMPER-*`).

---
