# 4AllPass AES-256-GCM Test Vectors (v1)

**Status:** Authoritative known-answer tests for Crypto Protocol v1  
**Date:** 2026-08-17  
**Machine-readable:** [`test-vectors/aes-gcm-v1.json`](test-vectors/aes-gcm-v1.json)  
**Verifier:** `node scripts/verify-aes-gcm-vectors.mjs`

These vectors pin AES-256-GCM **and** the canonical AAD encoding.  
Any compliant implementation must reproduce every `decrypt_ok` ciphertext/tag and must reject every `auth_fail` case.

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
These vectors use **fixed test nonces** so results are reproducible. A test-only hook (`encryptForTest(key, nonce, plaintext, aad)`) is allowed. Production `encrypt(...)` generates the nonce internally.

All hex in this document and in the JSON is **lowercase, no `0x`, no separators**.

---

## 2. Canonical AAD encoding (v1)

Naive concatenation (`vault_id || type || version`) is **not** used.  
It is ambiguous (variable-length IDs collide). v1 uses length-prefixed fields:

```
field  = uint16be(len) || bytes
AAD    = field || field || … || field
```

- `len` is the **byte** length of the field (0…65535), big-endian.
- String fields are UTF-8 **without** a trailing NUL.
- Integer version fields are **uint32be** (4 bytes), then length-prefixed like any other field (`len = 0x0004`).
- An absent optional string (e.g. `deviceId` on master/recovery envelopes) is encoded as an **empty field**: `00 00`.

### Envelope AAD fields (exact order)

```
1. "4allpass-envelope-v1"          // UTF-8 context string
2. vault_id                        // UTF-8
3. type                            // "master" | "device" | "recovery"
4. crypto_version                  // uint32be, currently 0x00000001
5. device_id                       // UTF-8, or empty
```

### Entry AAD fields (exact order)

```
1. "4allpass-entry-v1"             // UTF-8 context string
2. vault_id                        // UTF-8
3. entry_id                        // UTF-8
4. schema_version                  // uint32be
5. crypto_version                  // uint32be
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

---

## 3. Shared test constants

Used by all `TV-GCM-*`, `TV-ENV-*`, `TV-ENTRY-*`, `TV-TAMPER-*` vectors.  
**Never use these keys or nonces in production.**

| Name | Hex / value |
|---|---|
| `vault_id` | `vault_01HZX4ALLPASS000000000001` |
| `entry_id` | `entry_01HZX4ALLPASS0000000000A1` |
| `device_id` | `dev_macbook_chrome_profile_1` |
| `crypto_version` | `1` |
| `schema_version` | `1` |
| Vault Key (VK) | `00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff` |
| Master Key (MK) | `0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0` |
| Device Key (DK) | `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |
| Recovery Key (RK) | `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb` |

Precomputed AAD hex (must match `encodeAad` above):

| AAD | Hex |
|---|---|
| envelope / master | `001434616c6c706173732d656e76656c6f70652d7631001f7661756c745f3031485a5834414c4c5041535330303030303030303030303100066d61737465720004000000010000` |
| envelope / device | `001434616c6c706173732d656e76656c6f70652d7631001f7661756c745f3031485a5834414c4c504153533030303030303030303030310006646576696365000400000001001c6465765f6d6163626f6f6b5f6368726f6d655f70726f66696c655f31` |
| envelope / recovery | `001434616c6c706173732d656e76656c6f70652d7631001f7661756c745f3031485a5834414c4c5041535330303030303030303030303100087265636f766572790004000000010000` |
| entry | `001134616c6c706173732d656e7472792d7631001f7661756c745f3031485a5834414c4c50415353303030303030303030303031001f656e7472795f3031485a5834414c4c50415353303030303030303030304131000400000001000400000001` |

---

## 4. External interop (NIST / McGrew–Viega)

These prove the **primitive**, independent of 4AllPass AAD.  
Verified against OpenSSL (`node:crypto`) on 2026-08-17.

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

### TV-GCM-01 — short plaintext, empty AAD

| Field | Value |
|---|---|
| key | VK |
| nonce | `000000000000000000000001` |
| aad | *(empty)* |
| plaintext UTF-8 | `hello 4AllPass` |
| plaintext hex | `68656c6c6f2034416c6c50617373` |
| ciphertext | `bdc0febeb527aafe2ef40818372c` |
| tag | `335d23b66c40ad31b2de9e7fe133a149` |

### TV-GCM-02 — auth-only (empty plaintext)

| Field | Value |
|---|---|
| key | VK |
| nonce | `000000000000000000000002` |
| aad | `encodeAad(["4allpass-auth-only"])` = `001234616c6c706173732d617574682d6f6e6c79` |
| plaintext | *(empty)* |
| ciphertext | *(empty)* |
| tag | `ed46ba427b8de7313814735d9f4a337d` |

### TV-GCM-03 — 1024-byte patterned payload

Plaintext is 1024 bytes: `i & 0xff` for `i = 0…1023` (four repeats of `00…ff`).  
AAD = `encodeAad(["4allpass-bulk-v1"])`.  
Full hex is only in the JSON (`TV-GCM-03`).

| Field | Value |
|---|---|
| key | VK |
| nonce | `000000000000000000000003` |
| tag | `39895d685ad7265230146959f55aead4` |

### TV-ENV-MASTER — wrap VK under MK

| Field | Value |
|---|---|
| key | MK |
| nonce | `0102030405060708090a0b0c` |
| aad | envelope / master (table above) |
| plaintext | VK (32 bytes) |
| ciphertext | `04f1ec9da095f69a91497c81814c49e47f0c3fb76221f107d6787549ef5d4bbf` |
| tag | `e763408a5116fa8ebb42c89d7d72f834` |

### TV-ENV-DEVICE — wrap VK under DK

| Field | Value |
|---|---|
| key | DK |
| nonce | `ffffffffffffffffffffffff` |
| aad | envelope / device (table above) |
| plaintext | VK |
| ciphertext | `08eb0673c38c3f7aad95fbe123d66e16daf37e5446bedf96a57168928ea422ea` |
| tag | `501f81b10d20ca3e69ded3f7909b9f05` |

### TV-ENV-RECOVERY — wrap VK under RK

| Field | Value |
|---|---|
| key | RK |
| nonce | `deadbeefdeadbeefdeadbeef` |
| aad | envelope / recovery (table above) |
| plaintext | VK |
| ciphertext | `c8d07ffc0db334fbb0b924fc7ffe6fd05ca1a4e7f3cecf8d4f09134255253b8b` |
| tag | `3025f525fd2e6f40b386627e7fb46c34` |

### TV-ENTRY-01 — vault entry JSON

Plaintext is this exact UTF-8 JSON (no extra whitespace):

```json
{"title":"Example","username":"daniel","password":"correct-horse-battery-staple","url":"https://example.com","notes":"","totp":null,"custom":[]}
```

| Field | Value |
|---|---|
| key | VK |
| nonce | `111111111111111111111111` |
| aad | entry (table above) |
| ciphertext | `014de9a037b76db4090a41b1f480f3483109f2011f3a23b6c9a1565468b794235165b603292705206f0c1bb588e4377fb004f39881dc2aec613a1e774593244f4965eaccd5d3612059a7f415d7f0b7f22cf611d34730e62f4b288be34abd599612b72055f238816a94520860380430932c8f45300b99cab3b4a8a431b90021604630fc4f44fc071cbf5a1262a13f46f6` |
| tag | `d886ec507526387c422bd8a8c15764ac` |

---

## 6. Tamper vectors (`auth_fail` required)

An implementation **fails** this suite if any of these decrypt successfully.

| ID | Mutation | Base |
|---|---|---|
| `TV-TAMPER-CT` | first ciphertext byte XOR `0x01` | TV-GCM-01 |
| `TV-TAMPER-TAG` | first tag byte XOR `0x01` | TV-GCM-01 |
| `TV-TAMPER-AAD` | AAD replaced with `encodeAad(["wrong"])` | TV-GCM-01 |
| `TV-TAMPER-TYPE` | master envelope decrypted under **device** AAD | TV-ENV-MASTER |
| `TV-TAMPER-NONCE` | nonce `…0002` instead of `…0001` | TV-GCM-01 |
| `TV-TAMPER-KEY` | key = MK instead of VK | TV-GCM-01 |
| `TV-TAMPER-CROSS-VAULT` | entry AAD `vault_id` swapped | TV-ENTRY-01 |

Full hex for each case is in the JSON.

---

## 7. Compliance

A crypto core is **AES-GCM v1 compliant** when:

1. All `nist[]` and `success[]` vectors decrypt to the listed plaintext (and, if the implementation encrypts, reproduce ciphertext **and** tag for the given nonce).
2. Every `tamper[]` vector throws / returns authentication failure. No plaintext is released.
3. AAD is built with the length-prefixed encoder above — not string concatenation.
4. Production encrypt refuses a caller nonce.

Argon2id known-answer vectors are **out of scope** for this file.

---

## 8. How these were generated

```
node:crypto createCipheriv("aes-256-gcm", key, nonce)
  .setAAD(aad)
  .update(plaintext) + final()
  .getAuthTag()          // 16 bytes
```

Cross-checked with Web Crypto `SubtleCrypto.decrypt({ name: "AES-GCM", iv, additionalData, tagLength: 128 })` on Node 22 (ciphertext and tag concatenated).
