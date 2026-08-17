# 4AllPass WebAuthn / PRF Construction (v1)

**Status:** Authoritative for device unlock  
**Companion to:** `crypto-protocol.md` §5  
**Date:** 2026-08-17

WebAuthn is **not** an encryption oracle for the Vault Key.  
It unlocks a **Device Wrapping Key**, which unwraps a random **Device Key**, which unwraps the **Vault Key**.

This document is the byte-level construction. Do not invent another one.

---

## 1. Keys

| Key | Source | Lifetime |
|---|---|---|
| **Device Key (DK)** | Random 256-bit, generated after first master-password unlock on this device | Until the device is revoked or the vault key is rotated |
| **Device Wrapping Key (DWK)** | Derived from WebAuthn PRF output via HKDF | Ephemeral; re-derived on every biometric unlock |
| **Vault Key (VK)** | Random 256-bit | Wrapped in the Device Envelope on the server |

```
WebAuthn assertion + PRF
        │
        ▼
   32-byte PRF output          ← never used as a key
        │
        ▼
   HKDF-SHA-256
        │
        ▼
      DWK (32 bytes)
        │
        ▼
  unwrap Device-Key Envelope   ← local (or opaque server blob)
        │
        ▼
       DK
        │
        ▼
  unwrap Device Envelope       ← server
        │
        ▼
       VK
```

The server never sees PRF output, DWK, or DK in plaintext.

---

## 2. Preferred path: WebAuthn PRF

### 2.1 Registration

After the vault is unlocked with the Master Password:

1. `navigator.credentials.create` with `authenticatorSelection.userVerification = "required"`.
2. Request extension `prf` (and `hmac-secret` where needed as the CTAP equivalent).
3. Persist `credentialId`, `rpId`, `deviceId`.
4. Generate random **DK**.
5. Perform an assertion (or use the create-time PRF results if the platform returns them).
6. Derive **DWK** as in §3.
7. `wrapDeviceKey(DK, DWK)` → **Device-Key Envelope** (stored locally; may be mirrored to the server as an opaque blob).
8. `wrapVaultKey({ type: "device", wrappingKey: DK })` → **Device Envelope** (uploaded).

### 2.2 Unlock

1. `navigator.credentials.get` with `userVerification = "required"`.
2. `publicKey.extensions.prf.eval.first = prfEvalFirst(rpId, vaultId)`.
3. Read `clientExtensionResults.prf.results.first` (32 bytes). Missing or short output → abort, fall back to Master Password.
4. `DWK = deriveDeviceWrappingKey({ prfOutput, rpId, vaultId, deviceId, credentialId })`.
5. Unwrap Device-Key Envelope → DK.
6. Unwrap Device Envelope → VK.
7. Zeroize PRF output and DWK.

v1 uses **only** `eval.first` / `results.first`. `eval.second` is reserved.

### 2.3 `prf.eval.first`

```
preimage = encodeAad(["4allpass-webauthn-prf-v1", rp_id, vault_id])
prf.eval.first = SHA-256(preimage)     // always 32 bytes
```

`rp_id` is the WebAuthn RP ID string (e.g. `pass.example.local`).  
`vault_id` is the vault identifier.

Known-answer: **TV-PRF-EVAL-FIRST** in [`test-vectors/device-prf-v1.json`](test-vectors/device-prf-v1.json).

---

## 3. HKDF (mandatory — never use raw PRF output as a key)

```
DWK = HKDF-SHA-256(
  IKM  = prf.results.first,                         // 32 bytes
  salt = SHA-256(encodeAad(["4allpass-dwk-salt-v1", vault_id, credential_id])),
  info = encodeAad([
           "4allpass-device-wrap-v1",
           rp_id,
           vault_id,
           device_id,
           credential_id,
           crypto_version_u32be
         ]),
  L    = 32
)
```

`credential_id` is the raw WebAuthn credential id bytes.

This binds DWK to **this** RP, vault, device, credential, and protocol version.  
A PRF output copied from another origin cannot unwrap the Device-Key Envelope.

Known-answer: **TV-DWK-01**.

---

## 4. Device-Key Envelope

```
AAD = encodeAad([
  "4allpass-device-key-v1",
  vault_id,
  device_id,
  credential_id,
  crypto_version_u32be
])

ciphertext || tag = AES-256-GCM(DWK, DK, AAD)
```

Nonce is library-generated. Test hook only for KATs (**TV-DKE-01**).

`decrypt` uses the versions and ids stored on the envelope. Nothing is guessed.

### 4.1 Freshness (no independent rollback)

The Device-Key Envelope has **no revision field of its own**, and the DWK is
derived deterministically from `(rpId, vault_id, device_id, credential_id)` —
so re-wrapping a *new* Device Key for the same credential produces an envelope
with the **same AAD** as the old one. Nothing inside the blob distinguishes a
current Device-Key Envelope from a superseded one.

Therefore the Device-Key Envelope **must not** be rolled back or updated
independently of the vault snapshot it belongs to:

- When mirrored to the server (§2.1 step 7), it is versioned and committed
  **atomically with its vault-snapshot `revision`** (see
  `vault-revision.md` §4). A client fetches it only as part of the snapshot
  named by `active_revision`, never through a separate, independently
  replayable channel.
- Freshness of the Device-Key Envelope is thus inherited from the snapshot's
  `evaluateRevision` check. A malicious server that replays only an old
  Device-Key Envelope blob (e.g. to resurrect a rotated-out Device Key)
  either fails the snapshot freshness check or fails to unwrap the current
  Device Envelope under the stale Device Key — it never yields the Vault Key.

Implementations that store the mirror in a table separate from the snapshot
(as an optimization) still MUST gate serving it on the current
`active_revision` and MUST replace it in the same commit that rotates the
Device Key.

---

## 5. Fallback when PRF is unavailable

Evaluated in this order. Each step is a **lower** security level.

| Rank | Mechanism | Cryptographic bind to authenticator? |
|---:|---|---|
| 1 | WebAuthn PRF (§2–4) | Yes |
| 2 | WebAuthn **largeBlob** storing the Device-Key Envelope | Yes (authenticator-held) |
| 3 | **UV-gated local store** | **No** — policy only |

### Rank 3 (must be documented to the user)

- DK is wrapped under a random 256-bit **Local Storage Key** held in IndexedDB / platform storage.
- The client **refuses** to load that blob until a WebAuthn assertion with `userVerification = "required"` succeeds.
- A modified client or XSS after UV can skip the gate and read the blob.
- A remote / malicious server still cannot unwrap the Device Envelope (it never sees DK).

v1 **must** keep Master Password unlock available on every device.

---

## 6. What this is not

- PRF output is not the Vault Key.
- PRF output is not the Device Key.
- WebAuthn signatures are not mixed into HKDF (they are not a secret).
- Account login / OAuth has no input into this construction.

---

## 7. Browser notes (non-normative)

PRF support is uneven. Treat absence as fallback, not as a hard error.  
Always send `userVerification: "required"`.  
`rpId` must stay stable for the life of the vault’s device credentials.

---

## 8. Tests

`@4allpass/crypto` implements `prfEvalFirst`, `deriveDeviceWrappingKey`, `wrapDeviceKey`, `unwrapDeviceKey`.  
It does **not** talk to an authenticator. Vectors use a fixed 32-byte stand-in for `prf.results.first`.
