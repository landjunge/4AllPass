# 4AllPass AES-256-GCM Test Vectors (v1)

**Status:** Authoritative known-answer tests for Crypto Protocol v1  
**Date:** 2026-08-17  
**Machine-readable:** [`test-vectors/aes-gcm-v1.json`](test-vectors/aes-gcm-v1.json)  
**Generator:** `node scripts/generate-vectors.mjs`  
**Verifier:** `node scripts/verify-aes-gcm-vectors.mjs`

Companions: Argon2id vectors in [`test-vectors-argon2id.md`](test-vectors-argon2id.md),
device / PRF vectors in [`test-vectors/device-prf-v1.json`](test-vectors/device-prf-v1.json),
recovery vectors in [`test-vectors/recovery-v1.json`](test-vectors/recovery-v1.json).

These vectors pin AES-256-GCM **and** the canonical AAD encoding **and** the
snapshot-manifest encoding. Any compliant implementation must reproduce every
`decrypt_ok` ciphertext/tag and must reject every `auth_fail` case.

---

## 1. Primitive parameters (hard)

| Parameter | Value |
|---|---|
| Algorithm | AES-256-GCM (NIST SP 800-38D) |
| Key | 32 bytes |
| Nonce / IV | **12 bytes** (96-bit) |
| Tag | **16 bytes** (128-bit) |
| Ciphertext field | raw GCM ciphertext **without** tag |
| Storage concatenation | `ciphertext \|\| tag` (tag last) — WebCrypto-compatible |

**Production invariant:** the public library API must **not** accept a caller-supplied nonce.  
These vectors use **fixed test nonces** so results are reproducible. A test-only hook
(`@4allpass/crypto/test-only`) is allowed. Production `encrypt(...)` generates the nonce internally.

All hex in this document and in the JSON is **lowercase, no `0x`, no separators**.

---

## 2. Canonical encodings (v1)

### 2.1 AAD

Naive concatenation (`vault_id || type || version`) is **not** used.  
It is ambiguous (variable-length IDs collide). v1 uses length-prefixed fields:

```
field  = uint16be(len) || bytes
AAD    = field || field || … || field
```

- `len` is the **byte** length of the field (0…65535), big-endian.
- String fields are UTF-8 **without** a trailing NUL.
- Integer version fields are **uint32be** (4 bytes), then length-prefixed like any other field (`len = 0x0004`).
- An absent optional string (e.g. `deviceId` on master/recovery envelopes) is an **empty field**: `00 00`.
- An inapplicable version integer (e.g. `deviceKeyVersion` on a master envelope) is `uint32be(0)`.

#### Envelope AAD fields (exact order)

```
1. "4allpass-envelope-v1"          // UTF-8 context string
2. vault_id                        // UTF-8
3. type                            // "master" | "device" | "recovery"
4. crypto_version                  // uint32be
5. vault_key_version               // uint32be
6. device_id                       // UTF-8, or empty
7. device_key_version              // uint32be, 0 unless type === "device"
8. kdf_params_digest               // 32 bytes for master, empty otherwise
```

#### Entry AAD fields (exact order)

```
1. "4allpass-entry-v1"
2. vault_id
3. entry_id
4. schema_version                  // uint32be
5. crypto_version                  // uint32be
6. vault_key_version               // uint32be
```

#### Device-Key Envelope AAD fields (exact order)

```
1. "4allpass-device-key-v1"
2. vault_id
3. device_id
4. credential_id                   // raw WebAuthn credential id bytes
5. crypto_version                  // uint32be
6. device_key_version              // uint32be
```

#### Manifest AAD fields (exact order)

```
1. "4allpass-manifest-v1"
2. vault_id
3. crypto_version                  // uint32be
4. revision                        // uint32be
5. vault_key_version               // uint32be
```

Reference implementation (TypeScript):

```ts
function encodeAad(fields: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of fields) {
    if (f.length > 0xffff) throw new Error("AAD field too long");
    const len = new Uint8Array([(f.length >>> 8) & 0xff, f.length & 0xff]);
    parts.push(len, f);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}
```

### 2.2 Digest framing (`frame`)

Digest preimages use **uint32be** length prefixes, not uint16be, because an entry
ciphertext may exceed 65 535 bytes:

```
frame(x…) = for each field: uint32be(len) || bytes      // numbers are encoded as uint32be first
```

Used for the KDF parameter digest, the entry and envelope digests, the manifest body,
and the recovery checksum. Mixing the two framings is a protocol violation.

---

## 3. Shared test constants

Used by all `TV-GCM-*`, `TV-ENV-*`, `TV-ENTRY-*`, `TV-MANIFEST-*`, `TV-TAMPER-*` vectors.  
**Never use these keys or nonces in production.**

| Name | Hex / value |
|---|---|
| `vault_id` | `vault_01HZX4ALLPASS000000000001` |
| `entry_id` | `entry_01HZX4ALLPASS0000000000A1` |
| `device_id` | `dev_macbook_chrome_profile_1` |
| `crypto_version` | `1` |
| `schema_version` | `1` |
| `vault_key_version` | `3` |
| `device_key_version` | `2` |
| `revision` | `42` |
| Vault Key (VK) | `00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff` |
| Master Key (MK) | `0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0` |
| Device Key (DK) | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| Recovery Key (RK) | `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb` |

The version constants are deliberately **not** `1`: an implementation that defaults
`vault_key_version` or `device_key_version` to 1 fails these vectors instead of
passing them by accident.

Master-envelope KDF block (the test-only `ci` profile, pinned because its digest is
part of the envelope AAD):

| Field | Value |
|---|---|
| algorithm / version | `argon2id` / `0x13` |
| memory / iterations / parallelism | 32 KiB / 3 / 4 |
| hashLen | 32 |
| salt | `00112233445566778899aabbccddeeff` |
| `kdf_params_digest` | `a3de2bc083be4e6dbab03cb1fb43baabb3c5a241e07c0f7d2bc6db419dcbcc1c` |

Precomputed AAD hex (must match `encodeAad` above):

| AAD | Hex |
|---|---|
| envelope / master | `001434616c6c706173732d656e76656c6f70652d7631001f7661756c745f3031485a5834414c4c5041535330303030303030303030303100066d617374657200040000000100040000000300000004000000000020a3de2bc083be4e6dbab03cb1fb43baabb3c5a241e07c0f7d2bc6db419dcbcc1c` |
| envelope / device | `001434616c6c706173732d656e76656c6f70652d7631001f7661756c745f3031485a5834414c4c504153533030303030303030303030310006646576696365000400000001000400000003001c6465765f6d6163626f6f6b5f6368726f6d655f70726f66696c655f310004000000020000` |
| envelope / recovery | `001434616c6c706173732d656e76656c6f70652d7631001f7661756c745f3031485a5834414c4c5041535330303030303030303030303100087265636f7665727900040000000100040000000300000004000000000000` |
| entry | `001134616c6c706173732d656e7472792d7631001f7661756c745f3031485a5834414c4c50415353303030303030303030303031001f656e7472795f3031485a5834414c4c50415353303030303030303030304131000400000001000400000001000400000003` |
| manifest | `001434616c6c706173732d6d616e69666573742d7631001f7661756c745f3031485a5834414c4c5041535330303030303030303030303100040000000100040000002a000400000003` |
| device key (in `device-prf-v1.json`) | `001634616c6c706173732d6465766963652d6b65792d7631001f7661756c745f3031485a5834414c4c50415353303030303030303030303031001c6465765f6d6163626f6f6b5f6368726f6d655f70726f66696c655f310010cafebabecafebabecafebabecafebabe000400000001000400000002` |

---

## 4. External interop (NIST / McGrew–Viega)

These prove the **primitive**, independent of 4AllPass AAD.  
Verified against OpenSSL (`node:crypto`).

### TV-NIST-01 — empty PT, empty AAD

| Field | Hex |
|---|---|
| key | `0000000000000000000000000000000000000000000000000000000000000000` |
| nonce | `000000000000000000000000` |
| aad | *(empty)* |
| plaintext | *(empty)* |
| ciphertext | *(empty)* |
| tag | `530f8afbc74536b9a963b4f1c4cb738b` |

### TV-NIST-02 — 16-byte zero PT, empty AAD

| Field | Hex |
|---|---|
| key | `0000000000000000000000000000000000000000000000000000000000000000` |
| nonce | `000000000000000000000000` |
| aad | *(empty)* |
| plaintext | `00000000000000000000000000000000` |
| ciphertext | `cea7403d4d606b6e074ec5d3baf39d18` |
| tag | `d0d1c8a799996bf0265b98b5d48ab919` |

### TV-NIST-03 — 16-byte zero PT **and** 16-byte AAD

AAD changes the **tag only**. Ciphertext is identical to TV-NIST-02.

| Field | Hex |
|---|---|
| key | `0000000000000000000000000000000000000000000000000000000000000000` |
| nonce | `000000000000000000000000` |
| aad | `00000000000000000000000000000000` |
| plaintext | `00000000000000000000000000000000` |
| ciphertext | `cea7403d4d606b6e074ec5d3baf39d18` |
| tag | `ae9b1771dba9cf62b39be017940330b4` |

---

## 5. Protocol success vectors

| ID | Key | Nonce | Tag |
|---|---|---|---|
| `TV-GCM-01` | VK | `000000000000000000000001` | `335d23b66c40ad31b2de9e7fe133a149` |
| `TV-GCM-02` | VK | `000000000000000000000002` | `ed46ba427b8de7313814735d9f4a337d` |
| `TV-GCM-03` | VK | `000000000000000000000003` | `39895d685ad7265230146959f55aead4` |
| `TV-ENV-MASTER` | MK | `0102030405060708090a0b0c` | `bbedbbee9716e22bf184edce902e16e2` |
| `TV-ENV-DEVICE` | DK | `ffffffffffffffffffffffff` | `65b672c6af255172d327e20df5eecaef` |
| `TV-ENV-RECOVERY` | RK | `deadbeefdeadbeefdeadbeef` | `3e23de086018f004f436b0493cebd66b` |
| `TV-ENTRY-01` | VK | `111111111111111111111111` | `1b03a56dc7270b2fec68d9a8d76308db` |
| `TV-MANIFEST-01` | VK | `222222222222222222222222` | `484e7b93d1f145aee36d570c344dad88` |

Full ciphertexts are in the JSON. Details worth stating in prose:

### TV-GCM-01 — short plaintext, empty AAD

| Field | Value |
|---|---|
| plaintext UTF-8 | `hello 4AllPass` |
| plaintext hex | `68656c6c6f2034416c6c50617373` |
| ciphertext | `bdc0febeb527aafe2ef40818372c` |

### TV-GCM-02 — auth-only (empty plaintext)

AAD is `encodeAad(["4allpass-auth-only"])` = `001234616c6c706173732d617574682d6f6e6c79`.

### TV-GCM-03 — 1024-byte patterned payload

Plaintext is 1024 bytes: `i & 0xff` for `i = 0…1023`.  
AAD = `encodeAad(["4allpass-bulk-v1"])`.

### TV-ENV-MASTER / TV-ENV-DEVICE / TV-ENV-RECOVERY

Plaintext is VK (32 bytes) in all three. The AAD differs by `type`, and additionally by
`device_id` + `device_key_version` (device) and `kdf_params_digest` (master). Note that
the three ciphertexts are unchanged from the pre-AAD-extension vectors while the tags
are not: GCM ciphertext does not depend on AAD, the tag does.

`TV-ENV-RECOVERY` wraps under RK directly to isolate the primitive. The real protocol
wraps the Recovery Envelope under `RWK = HKDF(RK, …)` — see `TV-ENV-RECOVERY-RWK` in
[`recovery-v1.json`](test-vectors/recovery-v1.json).

### TV-ENTRY-01 — vault entry JSON

Plaintext is this exact UTF-8 JSON (no extra whitespace):

```json
{"title":"Example","username":"daniel","password":"correct-horse-battery-staple","url":"https://example.com","notes":"","totp":null,"custom":[]}
```

### TV-MANIFEST-01 — sealed snapshot manifest

Plaintext is the canonical manifest body (430 bytes) for the snapshot formed by
`TV-ENTRY-01` plus the three `TV-ENV-*` envelopes at `revision = 42`,
`vault_key_version = 3`. The body, its SHA-256, and the individual entry / envelope
digests are in `aes-gcm-v1.json` under `manifest`. Reproducing this vector proves the
manifest encoding, the digest framing, and the sort order all at once.

---

## 6. Tamper vectors (`auth_fail` required)

An implementation **fails** this suite if any of these decrypt successfully.

| ID | Mutation | Base |
|---|---|---|
| `TV-TAMPER-CT` | first ciphertext byte XOR `0x01` | TV-GCM-01 |
| `TV-TAMPER-TAG` | first tag byte XOR `0x01` | TV-GCM-01 |
| `TV-TAMPER-AAD` | AAD replaced with `encodeAad(["wrong"])` | TV-GCM-01 |
| `TV-TAMPER-NONCE` | nonce `…0002` instead of `…0001` | TV-GCM-01 |
| `TV-TAMPER-KEY` | key = MK instead of VK | TV-GCM-01 |
| `TV-TAMPER-TYPE` | master envelope decrypted under **device** AAD | TV-ENV-MASTER |
| `TV-TAMPER-KDF-PARAMS` | KDF memory/iterations/lanes weakened | TV-ENV-MASTER |
| `TV-TAMPER-KDF-SALT` | KDF salt swapped | TV-ENV-MASTER |
| `TV-TAMPER-DEVICE-KEY-VERSION` | `device_key_version` rolled back | TV-ENV-DEVICE |
| `TV-TAMPER-CROSS-DEVICE` | envelope claimed for another `device_id` | TV-ENV-DEVICE |
| `TV-TAMPER-CROSS-VAULT` | entry AAD `vault_id` swapped | TV-ENTRY-01 |
| `TV-TAMPER-CROSS-ENTRY` | entry AAD `entry_id` swapped (record moved to another slot) | TV-ENTRY-01 |
| `TV-TAMPER-SCHEMA-VERSION` | entry AAD `schema_version` changed | TV-ENTRY-01 |
| `TV-TAMPER-VAULT-KEY-VERSION` | entry AAD `vault_key_version` rolled back | TV-ENTRY-01 |
| `TV-TAMPER-REVISION` | manifest replayed under a higher `revision` | TV-MANIFEST-01 |
| `TV-TAMPER-MANIFEST-KEY-VERSION` | manifest replayed under another `vault_key_version` | TV-MANIFEST-01 |

Full hex for each case is in the JSON. The device-side equivalents
(`TV-DKE-WRONG-DWK`, `TV-DKE-CREDENTIAL-SWAP`, `TV-DKE-VERSION-ROLLBACK`) live in
`device-prf-v1.json`.

---

## 7. Compliance

A crypto core is **AES-GCM v1 compliant** when:

1. All `nist[]` and `success[]` vectors decrypt to the listed plaintext (and, if the implementation encrypts, reproduce ciphertext **and** tag for the given nonce).
2. Every `tamper[]` vector throws / returns authentication failure. No plaintext is released.
3. AAD is built with the length-prefixed encoder above — not string concatenation — and digest preimages use the uint32be framing.
4. `TV-MANIFEST-01`'s manifest body is reproduced byte for byte.
5. Production encrypt refuses a caller nonce.

Argon2id known-answer vectors are **out of scope** for this file.

---

## 8. How these were generated

```sh
node scripts/generate-vectors.mjs            # writes aes-gcm / device-prf / recovery JSON
node scripts/generate-vectors.mjs --print-markdown   # prints the tables above
```

The generator implements the AAD encoder, the digest framing, the manifest encoding
and Crockford Base32 **longhand from this specification**, and seals with
`node:crypto` (`createCipheriv("aes-256-gcm")`, `hkdfSync`). It never imports
`packages/crypto`. Generating the vectors from the implementation under test would
turn known-answer tests into a snapshot of the code.

`scripts/verify-aes-gcm-vectors.mjs` re-checks every vector against `node:crypto`
independently; the TypeScript test suite checks the same vectors against
`@noble/ciphers` and `@noble/hashes`.
