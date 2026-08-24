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

The HTTP calls that persist `credentialId` / `rpId` / `prfSupported` are
**metadata registration**. They do not prove possession to the server. The
backend stores those fields as `verification: "client_asserted"` and never
sees PRF output. See `docs/security-boundary.md`.

### 2.2 Unlock

1. `navigator.credentials.get` with `userVerification = "required"`.
2. `publicKey.extensions.prf.eval.first = prfEvalFirst(rpId, vaultId)`.
3. Read `clientExtensionResults.prf.results.first` (32 bytes). Missing, short, or all-zero output → abort, fall back to Master Password.
4. `DWK = deriveDeviceWrappingKey({ prfOutput, rpId, vaultId, deviceId, credentialId })`.
5. Unwrap Device-Key Envelope → DK, stating the expected vault, device, credential and `deviceKeyVersion`.
6. Unwrap Device Envelope → VK, stating the expected `deviceId`, `deviceKeyVersion` and `vaultKeyVersion`.
7. Zeroize PRF output and DWK.

An all-zero `results.first` is treated as "no PRF material", not as a key: a
32-byte zero buffer is what a mis-wired fallback produces, and deriving from it
would yield a publicly computable DWK.

v1 uses **only** `eval.first` / `results.first`. `eval.second` is reserved.

### 2.3 `prf.eval.first`

```
preimage = encodeAad(["4allpass-webauthn-prf-v1", rp_id, vault_id])
prf.eval.first = SHA-256(preimage)     // always 32 bytes
```

`rp_id` is the WebAuthn RP ID string (e.g. `pass.example.local`).  
`vault_id` is the vault identifier.

Known-answer: **TV-PRF-EVAL-FIRST** in [`test-vectors/device-prf-v1.json`](test-vectors/device-prf-v1.json).

### 2.4 Server-issued ceremony challenge

`publicKey.challenge` is **not** generated on the client.

```
POST /api/v1/vaults/{vaultId}/webauthn/challenges
Authorization: Bearer <account session>
{ "purpose": "create" | "assert", "deviceId": "dev_…" }

→ { challengeId, challenge, expiresIn, purpose }
```

Rules:

| # | Rule |
|---|---|
| C1 | Caller must own the vault (`get_owned_vault`). |
| C2 | `challenge` is 32 fresh random bytes, returned **once**, standard base64. |
| C3 | The server stores only `SHA-256(challenge)` plus `(user, vault, purpose, deviceId)`. |
| C4 | TTL is 120 seconds. |
| C5 | One challenge is valid for **exactly one** `navigator.credentials.create` or `.get`. Enable/unlock that perform several ceremonies issue several challenges. |
| C6 | `POST .../challenges/{challengeId}/consume` with the same bytes + purpose is single-use. Missing, expired, reused, or bound to another vault/user/purpose → 404. |
| C7 | Rate-limited per account+vault. |
| C8 | This is not vault-key material and is not mixed into HKDF. |

The PWA injects a `ChallengeProvider` into `@4allpass/webauthn`. Unit tests may omit it and fall back to a local `newChallenge()`.

Consuming the challenge with an assertion (`clientDataJSON`, `authenticatorData`,
`signature`, `credentialId`) verifies the COSE signature against the stored
public key and this challenge, then updates `signCount`. Registration posts
the `fmt=none` attestation with the create challenge; the server extracts the
COSE key. That is ceremony integrity. It is **not** PRF verification and is
not mixed into HKDF.

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
  crypto_version_u32be,
  device_key_version_u32be
])

ciphertext || tag = AES-256-GCM(DWK, DK, AAD)
```

Nonce is library-generated. Test hook only for KATs (**TV-DKE-01**).

The envelope stores `vaultId`, `deviceId`, `credentialId` and `deviceKeyVersion`,
and the AAD is built from them. That makes it self-consistent but **not**
self-authenticating: an envelope belonging to another vault, device or credential
unwraps perfectly well as long as the matching DWK is derived from the same fields.
The caller must therefore state what it expects:

```
unwrapDeviceKey(envelope, {
  deviceWrappingKey,
  vaultId, deviceId, credentialId, deviceKeyVersion,   // all required
})
```

A disagreement is an `IntegrityError` before decryption. Rejections:
**TV-DKE-CREDENTIAL-SWAP**, **TV-DKE-VERSION-ROLLBACK**, **TV-DKE-WRONG-DWK**.

### 4.1 `deviceKeyVersion` and Device-Key rotation

`deviceKeyVersion` counts generations of **this device's** Device Key. It is
independent of `vault_key_version`, which counts generations of the Vault Key.

| Event | `deviceKeyVersion` | `vault_key_version` |
|---|---|---|
| Vault Key rotation (hard revocation) | unchanged | +1 |
| This device re-enrols / replaces its WebAuthn credential | +1 (`nextDeviceKeyVersion` in the PWA) | unchanged |
| Device-Key Envelope re-wrapped under a new DWK for the *same* DK | unchanged | unchanged |

Rotating a Device Key:

1. Generate a new random DK, `deviceKeyVersion = n+1`.
2. `wrapDeviceKey({ …, deviceKeyVersion: n+1 })` → replace the local Device-Key Envelope.
3. `wrapVaultKey({ type: "device", deviceId, deviceKeyVersion: n+1, vaultKeyVersion })` → publish in the next snapshot.
4. The old Device Envelope disappears with the snapshot it belonged to; replaying it
   fails both the expectation check and the snapshot manifest.

Because the version is inside both AADs, a server cannot hand back generation `n`
after the device has moved to `n+1`.

### 4.2 Freshness (no independent rollback)

`deviceKeyVersion` (§4.1) makes a *superseded* Device-Key Envelope
distinguishable: it is inside the AAD, so an envelope from generation `n` cannot
be opened by a client that expects `n+1`. What the version alone does not supply
is the knowledge of which generation is current — the DWK is derived
deterministically from `(rpId, vault_id, device_id, credential_id)`, so a stale
envelope is still a perfectly valid blob for anyone who does not know better.
That knowledge comes from the snapshot.

Therefore the Device-Key Envelope **must not** be rolled back or updated
independently of the vault snapshot it belongs to:

- When mirrored to the server (§2.1 step 7), it is versioned and committed
  **atomically with its vault-snapshot `revision`** (see
  `vault-revision.md` §4). The PWA commits the snapshot first, then PUTs the
  mirror with `expectedRevision`. GET refuses a blob whose `deviceKeyVersion`
  does not match the device envelope in `active_revision`. A client must not
  treat the mirror as an independently replayable channel.
- Freshness of the Device-Key Envelope is thus inherited from the snapshot's
  `evaluateRevision` check. A malicious server that replays only an old
  Device-Key Envelope blob (e.g. to resurrect a rotated-out Device Key) fails on
  any of three counts: the snapshot freshness check, the `deviceKeyVersion` the
  caller states when opening it, or the current Device Envelope refusing to
  unwrap under the stale Device Key — it never yields the Vault Key.

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

### Rank 2 storage split

There is no PRF output at rank 2, so the Device-Key Envelope is wrapped under a
random 256-bit **Blob Wrapping Key**. The two halves are stored apart:

| | Device-Key Envelope | Wrapping key |
|---|---|---|
| Rank 2 | authenticator `largeBlob` | local store |
| Rank 3 | local store | local store |

Unlocking at rank 2 therefore needs a UV assertion on that authenticator *and*
this browser profile's local store. A stolen local store alone is not enough,
which is what keeps rank 2 above rank 3.

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
`PublicKeyCredential` / `navigator.credentials` existing is **not** a PRF
proof. The PWA probes `getClientCapabilities` (`probeWebviewWebauthn`);
desktop WKWebView typically reports `prf: null`. Devices and Welcome must
not hide the fallback hint on API presence alone.  
Always send `userVerification: "required"`.  
`rpId` must stay stable for the life of the vault’s device credentials.

---

## 8. Tests

`@4allpass/crypto` implements `prfEvalFirst`, `deriveDeviceWrappingKey`, `wrapDeviceKey`, `unwrapDeviceKey`, plus the zeroizing orchestration `bindDeviceWithPrfOutput` / `unwrapVaultKeyWithPrfOutput`.  
It does **not** talk to an authenticator. Vectors use a fixed 32-byte stand-in for `prf.results.first`.

`@4allpass/webauthn` owns the authenticator side: the UV-required ceremonies, the
`rpIdHash` / UP / UV checks on `authenticatorData`, the rank selection of §5, and
the local record. See [`packages/webauthn`](../packages/webauthn).
