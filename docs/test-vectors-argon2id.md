# 4AllPass Argon2id Test Vectors (v1)

**Status:** Authoritative known-answer tests for Crypto Protocol v1  
**Date:** 2026-08-17  
**Machine-readable:** [`test-vectors/argon2id-v1.json`](test-vectors/argon2id-v1.json)  
**Verifier:** `pip install -r scripts/requirements-dev.txt && python3 scripts/verify-argon2id-vectors.py`

Companion: AES-256-GCM vectors in [`test-vectors.md`](test-vectors.md).

These vectors pin Argon2id **and** the 4AllPass KDF profiles.  
A compliant implementation must reproduce every `derive_ok` digest and must reject the wrap of a wrong-password MK.

Verified independently with **argon2-cffi 25.1.0** (reference C library) and **@noble/hashes 2.3.0**.

---

## 1. Primitive parameters (hard)

| Parameter | Value |
|---|---|
| Algorithm | Argon2id (RFC 9106), version **0x13** (19) |
| Output / MK | **32 bytes** (256-bit) |
| Salt | 16 bytes default; 16 or 32 bytes allowed |
| Secret (K) | **empty** for master-password derivation |
| Associated data (X) | **empty** for master-password derivation |
| Password encoding | Unicode **NFC**, then UTF-8 |

RFC 9106 §5.3 includes a secret and associated data. That vector (`TV-ARGON2-RFC9106`) proves the full primitive. **4AllPass never sets K or X** when deriving the Master Key.

PHC-encoded strings (`$argon2id$v=19$m=…`) are interoperability-only. The protocol stores parameters inside `KeyEnvelope.kdf`, not as a PHC string.

---

## 2. Profiles

| Name | Memory | t | p | Production |
|---|---:|---:|---:|---|
| `ci` | 32 KiB | 3 | 4 | **No** — unit tests only |
| `mobile_safe` | 32 MiB | 3 | 1 | Yes |
| `balanced` | 32 MiB | 6 | 4 | Yes |
| **`standard`** (default) | **64 MiB** | **3** | **4** | Yes — new vaults |
| `high` | 128 MiB | 4 | 4 | Yes |

`standard` matches RFC 9106 **SECOND RECOMMENDED** memory (64 MiB) with `t=3, p=4`.  
`ci` exists so CI does not need 64 MiB per test. Creating a production vault with `ci` is a spec violation.

Chosen parameters **must** be stored in the Master Envelope so later clients can re-derive MK after a profile upgrade.

---

## 3. Shared test constants

**Never use these passwords or salts in production.**

| Name | Value |
|---|---|
| Master password | `correct-horse-battery-staple` |
| Salt (16 B) | `00112233445566778899aabbccddeeff` |
| Vault Key (for wrap) | same VK as the AES-GCM suite |
| Wrong password | `correct-horse-battery-staple!` |
| Unicode password | `paßwort-🔑` (NFC, UTF-8 `7061c39f776f72742df09f9491`) |

---

## 4. External interop

### TV-ARGON2-RFC9106 — RFC 9106 §5.3 (with K and X)

| Field | Hex |
|---|---|
| password | 32 × `01` |
| salt | 16 × `02` |
| secret K | 8 × `03` |
| associated data X | 12 × `04` |
| m / t / p | 32 / 3 / 4 |
| dk | `0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659` |

### TV-ARGON2-RFC9106-NOSECRET — same, empty K and X

| Field | Hex |
|---|---|
| dk | `03aab965c12001c9d7d0d2de33192c0494b684bb148196d73c1df1acaf6d0c2e` |

### TV-ARGON2-PHC-PASSWORD

`password` / `somesalt`, m=32, t=2, p=4 →  
`d74d7db154b312931625cde5a51f76bc52113b4b0515aa94952203b3cc45b800`

---

## 5. Profile vectors

Password and 16-byte salt as in §3.

| ID | Profile | MK (dk) |
|---|---|---|
| TV-ARGON2-CI | ci | `68a99687349511a4867fd857daec2352bceb4e8e557be3a04de2b53f51d3675a` |
| TV-ARGON2-MOBILE | mobile_safe | `f757ecbc55205b9a210d36e65f36ed86fcd9b23774a421a2b899c742e70fcb56` |
| TV-ARGON2-BALANCED | balanced | `8c4d9b3ea71db83dd54dc2f99b50b5f4ef545e893bbbd5202d3897d0dad1e387` |
| TV-ARGON2-STANDARD | standard | `b00050c39e6fc6bb6bf23e2ff84b2d40c5a7858fdab5e6318e76ced3f53a23b8` |
| TV-ARGON2-HIGH | high | `e6732d03ff635233b5d67af0cbd481b907cb9267e299c4299bb57de7988ca4f4` |
| TV-ARGON2-UNICODE | ci + unicode pw | `60fbc03f41be55bc75ab6238ea036acdc2dfe0e512100fcb48e4ff173dc7e966` |
| TV-ARGON2-SALT32 | ci + 32 B salt | `c7a4dddf4790d9982260ba69eabfbfe4d6a0d54be346799475cacdb23902a76e` |
| TV-ARGON2-WRONGPW | ci + extra `!` | `f4eb416a16994fca01dafa5bc2418a2e414da329daf93a5d3bc238ca80f60147` |

`TV-ARGON2-WRONGPW.dk` **must** differ from `TV-ARGON2-CI.dk`.

Optional PHC form for the default profile:

```
$argon2id$v=19$m=65536,t=3,p=4$ABEiM0RVZneImaq7zN3u/w$sABQw55vxrtr8j4v+EstQMWnhY/ateYxjnbO0/U6I7g
```

---

## 6. Composite wrap (Argon2id → MK → AES-GCM envelope)

Uses the same master-envelope AAD as the AES-GCM suite.

### TV-ARGON2-WRAP

| Field | Value |
|---|---|
| key (MK from CI) | `68a99687…d3675a` |
| nonce | `0102030405060708090a0b0c` |
| plaintext | VK |
| ciphertext | `9e9c24a404a4c0d9a1ee72cfffba9c7137ee6480b6869ceba20f13baf4c52d3a` |
| tag | `50e704d06144c31a6b3e02404bac3f72` |

### TV-ARGON2-WRAP-WRONGPW

Same ciphertext/tag/nonce/AAD, key = wrong-password MK.  
**Must** fail authentication. No plaintext released.

---

## 7. Compliance

A crypto core is **Argon2id v1 compliant** when:

1. `TV-ARGON2-RFC9106` matches (if the library exposes K and X).
2. Every `success[]` digest matches, including unicode and 32-byte salt.
3. `TV-ARGON2-WRONGPW` differs from `TV-ARGON2-CI`.
4. `TV-ARGON2-WRAP` decrypts to VK; `TV-ARGON2-WRAP-WRONGPW` fails.
5. Production vaults never persist the `ci` profile.
6. Password is NFC-normalized before UTF-8.

Fast CI may skip `TV-ARGON2-MOBILE`, `BALANCED`, `STANDARD`, and `HIGH` (they need 32–128 MiB). It **must not** skip `CI`, RFC, unicode, wrong-password, or wrap.
