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
7. **Versions are never defaulted.** `vaultKeyVersion`, `deviceKeyVersion`, `schemaVersion` and `cryptoVersion` are always stated explicitly by the writer and read back from the object.
8. **Every field of an envelope or entry is authenticated.** Any metadata that is not covered by AAD (or by the manifest of §8.1) must be rejected, never ignored.
9. **Opening is always done against an expectation.** AAD built from the object's own fields proves self-consistency, not identity: the caller states which vault, which entry, which device and which key generation it intends to open, and a mismatch is an error before decryption.
10. **`revision` is only trustworthy after the manifest verifies** (§8.1). A revision number that was merely asserted by the server must never be pinned.

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

Worked hex and encrypt/decrypt known-answer tests: **[docs/test-vectors.md](test-vectors.md)** (`TV-ENV-*`, `TV-TAMPER-*`).

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

### 4.1 Validating parameters that came back from the server

The `kdf` block is untrusted input on the unlock path: it is stored by the server
and it instructs the client to allocate memory. Every read **must** be validated
before it reaches Argon2id:

| Check | Bound | Attack prevented |
|---|---|---|
| `algorithm` | exactly `argon2id` | variant substitution (argon2i / argon2d) |
| `version` | exactly `0x13` | derivation under an older, weaker Argon2 |
| `hashLen` | exactly 32 | short Master Key |
| `memory` | ≥ 32 MiB (production floor) and ≤ 1 GiB | KDF downgrade / client memory exhaustion |
| `iterations` | 1…16 | KDF downgrade / CPU exhaustion |
| `parallelism` | 1…16 | KDF downgrade / resource exhaustion |
| `salt` | exactly 16 or 32 bytes | ambiguous or degenerate salt |

The `ci` profile is below the production floor and is only accepted when the caller
explicitly opts in (`allowTestProfile: true`), which production code never does.
Because the parameter digest is in the envelope AAD (§3.1), a rewritten parameter
set additionally fails the GCM tag.

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

### Key generations on the device path

Two independent counters exist, and confusing them is a rollback vector:

| Counter | Increments when | Lives on |
|---|---|---|
| `vault_key_version` | the Vault Key is rotated (hard revocation) | snapshot, every envelope, every entry, manifest |
| `device_key_version` | this device's Device Key is rotated (new DK, e.g. re-enrolment or credential replacement) | Device-Key Envelope (local) and the matching Device Envelope |

Both are authenticated (§3.1). A Device Envelope wrapped under `device_key_version 1`
can therefore not be replayed to a device that has already rotated to 2, and a
Device-Key Envelope from an earlier generation is refused rather than silently
opened.

---

## 6. Recovery

### Primary Recovery Mechanism (v1)
**Recovery Key** (recommended and required for production vaults)

- Generated once at vault creation (cryptographically random, 256 bit).
- Encoded for humans as **Crockford Base32 of `key || checksum`** in groups of five — see **[docs/recovery.md](recovery.md)** for the exact encoding and the Recovery Wrapping Key derivation.
- The printed key is **never** used directly as an AES key: `RWK = HKDF-SHA-256(recovery key, vault-bound salt/info)` wraps the Recovery Envelope.
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
1. User provides the Recovery Key; the client normalizes it and verifies the checksum (a typo is reported as a typo, not as “wrong key”).
2. Client derives `RWK` and unwraps the Recovery Envelope → obtains Vault Key.
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
  vaultKeyVersion: number;    // VK generation that sealed this entry
  nonce: Uint8Array;          // 12 bytes
  ciphertext: Uint8Array;     // raw GCM ciphertext (no tag)
  tag: Uint8Array;            // 16-byte auth tag
}
```

`decryptEntry(entry, { vaultKey, vaultId, entryId, vaultKeyVersion })` reads
`schemaVersion`, `cryptoVersion` and `vaultKeyVersion` **from the entry** and
compares the identity fields against what the caller asked for. That is what keeps
a v2 payload decryptable after a schema bump *and* prevents a record from being
served in the slot of a different entry.

### Rules
- Public library API must **not** accept a caller-supplied nonce.
- Nonce is always generated inside the library (`crypto.getRandomValues` or equivalent CSPRNG).
- A test-only hook may accept a nonce solely to reproduce [docs/test-vectors.md](test-vectors.md).
- Mandatory AAD for every entry encryption, using the encoder in §3.1:

  ```
  "4allpass-entry-v1" || vault_id || entry_id || schema_version_u32be || crypto_version_u32be || vault_key_version_u32be
  ```

  All three version integers in the AAD are the values stored on that same `EncryptedEntry`.

- `entry_id` in the AAD is the entry's own id, so the caller **must** pass the id it
  requested: the AAD proves the record is internally consistent, not that it is the
  record that was asked for.
- `revision` is deliberately **not** part of the entry AAD. It changes on every
  write, so binding it per entry would require re-sealing the whole vault for each
  edit. Freshness of the entry *set* is covered by the manifest (§8.1).
- Plaintext is only ever present on the client after successful unlock.

Worked hex: **TV-ENTRY-01**. Substitution rejections: **TV-TAMPER-CROSS-VAULT**,
**TV-TAMPER-CROSS-ENTRY**, **TV-TAMPER-VAULT-KEY-VERSION**.

---

## 8.1 Snapshot Manifest (authenticated `revision`)

Per-object AEAD proves that each entry and envelope was not modified. It proves
nothing about *which set* of objects a snapshot contains, and nothing about the
`revision` number the server attaches to them. The manifest closes both gaps.

```ts
interface SnapshotManifest {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion: number;
  entries: Array<{ id; schemaVersion; cryptoVersion; vaultKeyVersion; digest }>;   // digest = SHA-256 of the sealed entry
  envelopes: Array<{ type; deviceId; vaultKeyVersion; deviceKeyVersion; digest }>; // digest = SHA-256 of the sealed envelope
}
```

The manifest body is encoded canonically and sealed under the **Vault Key**:

```
frame(x…)        = for each field: uint32be(len) || bytes      // numbers are uint32be
body             = frame("4allpass-manifest-content-v1", vault_id, crypto_version,
                         revision, vault_key_version, entry_count, envelope_count)
                   || frame(entry_id, schema_version, crypto_version, vault_key_version, digest)*
                   || frame(type, device_id_or_empty, vault_key_version, device_key_version, digest)*
sealed manifest  = AES-256-GCM(VK, body, AAD = manifest AAD of §3.1)
```

Rules:

- Entries are sorted by `entry_id`, envelopes by `(type, device_id)`, comparing the
  **UTF-8 bytes** — not UTF-16 code units, which would order astral characters
  differently from the wire format. Ids are unique; a duplicate id or two envelopes
  for one device is an error. Canonical form matters because the manifest is the
  object being authenticated.
- A snapshot has **exactly one** `vault_key_version`. Every entry and envelope in it
  must carry that same value; a manifest that spans two generations is not
  representable.
- Digests cover the complete sealed object, including nonce, ciphertext, tag, all
  versions and (for master envelopes) the KDF parameter digest.

### Client verification order

1. Fetch the snapshot named by `active_revision`.
2. Obtain VK by unwrapping one envelope (Master, Device or Recovery) — against explicit
   expectations, §3.2.
3. `verifySnapshotManifest(sealed, { entries, envelopes }, { vaultKey, vaultId, revision, vaultKeyVersion })`.
   The GCM tag decides whether the server's claimed `revision` is real, the decoded
   body must agree with the AAD, and the snapshot must be exactly the declared set:
   no substitutions, nothing missing, nothing extra.
4. **Apply the records that verification returned**, not the ones that were passed in
   (§8.2).
5. Run the content integrity pass of §8.3 (`verifySnapshot` / `unlockSnapshot`): every
   entry must decrypt under that one Vault Key, and every other envelope the client can
   unwrap must yield the same one.
6. Only now compute the freshness decision (`evaluateRevision`) and pin the result
   with `revisionFromManifest(verified)`, which carries the digest of the blob that was
   actually authenticated. Passing a manifest and a sealed blob separately is not
   allowed: pinning the digest of an unverified blob would turn the equivocation check
   into noise — the honest snapshot would then be rejected as a fork.

### 8.2 Verify and use must see the same bytes

A digest only means something if the bytes that were digested are the bytes that get
decrypted. Two rules follow, and they are requirements on implementations, not
suggestions:

- **Read each field of an untrusted record exactly once**, into a normalized copy, and
  digest that copy. A record whose fields are accessors rather than data — the natural
  output of a JSON reviver, a lazily-decoding transport wrapper, or a model layer — can
  otherwise answer differently on a second read, presenting honest bytes to the checks
  and stale bytes to the digest. `Uint8Array` fields must be copied, since a `Proxy`
  over one passes every type and length check and can still change its bytes.
- **Hand the normalized records back to the caller** and require that those are the
  ones applied. Anything else re-opens the same gap one layer up:
  `verifySnapshotManifest(...)` returns `{ manifest, sealedDigest, entries, envelopes }` for
  exactly this reason.

Identifiers get the same treatment: a string containing an unpaired surrogate has no
UTF-8 encoding, and `TextEncoder` would silently replace it with U+FFFD — so
`"\uD800"`, `"\uDC00"` and `"\uFFFD"` would share one AAD and one digest preimage.
Since `vault_id` is server-supplied and is the only cryptographic separator between
vaults, ill-formed UTF-16 must be **rejected**, not encoded.

Finally, the framing of §8.1 is safe because every preimage has **fixed arity and a
fixed field order**: `frame()` encodes the number `1` and the four bytes
`00 00 00 01` identically, so an optional or variable-arity field would introduce a
genuine ambiguity. New fields therefore go at the end of a preimage, are never
optional, and a new preimage gets a new label.

---

## 8.3 Content integrity pass

The manifest proves *which records* belong to the snapshot. It does not prove that
they all decrypt: a client that holds VK for generation `v` and is handed a
manifest-consistent snapshot at generation `v` still has to establish that every
record really is under that one key. That is the pass specified in
`vault-revision.md` §6 and implemented as `verifySnapshot` / `unlockSnapshot`:

- every entry must decrypt under the Vault Key the client obtained, and
- every additional envelope the client can unwrap (e.g. the master envelope
  alongside a device envelope) must yield the **same** Vault Key.

A single failure rejects the whole snapshot with `IntegrityError`. A wrong wrapping
key (wrong Master Password) is *not* an integrity failure — it stays
`AuthFailureError`, because it is an ordinary, expected condition.

The two mechanisms are complementary and neither replaces the other:

| | Manifest (§8.1) | Content pass (§8.3) |
|---|---|---|
| Authenticates `revision` | yes | no |
| Detects records that are valid but not part of this snapshot | yes | no |
| Detects a dropped or injected record | yes | only if it fails to decrypt |
| Detects `VK₁` entries under `VK₂` envelopes | yes, structurally | yes, by decryption |
| Works on a snapshot published without a manifest | no | yes |
| Needs a wrapping key beyond VK | no | only for cross-checks |

Run the manifest check first where a manifest exists; the content pass is the only
available defence for snapshots that predate it.

What this catches that per-object AEAD does not:

| Server behaviour | Detected by |
|---|---|
| `revision = 50` attached to snapshot 42 | manifest AAD → `AuthFailureError` |
| Entries from revision 41 served with revision 42's metadata | digest set mismatch |
| An entry silently dropped (truncation) | declared count / digest set |
| An extra entry injected | digest set |
| A revoked device's envelope re-attached | envelope digest set |
| Two different snapshots served under one revision | pinned `manifestDigest` → `mismatch` |

Known-answer tests: **TV-MANIFEST-01**, **TV-TAMPER-REVISION**,
**TV-TAMPER-MANIFEST-KEY-VERSION**.

---

## 9. Serialization, Versioning & Future Migration

- Every KeyEnvelope carries `version: 1` (crypto protocol) and a `vaultKeyVersion`.
- Every EncryptedEntry carries `cryptoVersion: 1`, a `schemaVersion` of its plaintext, and a `vaultKeyVersion`.
- Every Device-Key Envelope carries `version: 1` and a `deviceKeyVersion`.
- The vault snapshot records `crypto_protocol_version`, `revision`, and `vault_key_version` in an authenticated manifest (§8.1) — see [vault-revision.md](vault-revision.md).
- Byte fields are `Uint8Array`. A deserializer that produces arrays of numbers (plain `JSON.parse`) must be rejected as malformed input rather than reaching AEAD, where it would look like tampering.
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
- Vault metadata (`vault_id`, creation time, `crypto_protocol_version`, `revision`, `vault_key_version`) — note that this metadata is **advisory**: the client only believes it once the sealed manifest verifies (§8.1)
- Immutable snapshots (envelopes + entries + sealed manifest) and the `active_revision` pointer
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
- **Manifest and recovery vectors** in [`docs/test-vectors/recovery-v1.json`](test-vectors/recovery-v1.json) and the `TV-MANIFEST-*` entries of `aes-gcm-v1.json`
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

Findings, decisions and residual risks: **[docs/adversarial-review.md](adversarial-review.md)**.

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
| **`security-boundary.md`** | **Auth ≠ authorization ≠ crypto; session, IDOR, revocation honesty** |
| `device-management.md`    | Device identity, registration UX, revocation flows  |

---

**Crypto Protocol v1 – End of Specification**

This document is intentionally strict.  
Any implementation that cannot satisfy the invariants above is not compliant with 4AllPass Crypto Protocol v1.
