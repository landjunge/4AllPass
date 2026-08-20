# `@4allpass/webauthn`

Device unlock for the browser. Implements `docs/webauthn-prf.md`: WebAuthn is a
platform-protected trigger for a **Device Wrapping Key**, never an encryption
oracle for the Vault Key.

```
src/
  types.ts               WebAuthnClient boundary, DeviceUnlockRecord, ranks
  errors.ts              WebAuthnUnavailable / PrfUnavailable / UserVerification / DeviceUnlockUnavailable
  browser-client.ts      the only file that touches navigator.credentials
  authenticator-data.ts  rpIdHash + UP/UV flag checks
  challenge.ts           server-issued 32-byte ceremony challenge (or test fallback)
  prf.ts                 assertion → prf.results.first (32 bytes, else abort)
  large-blob.ts          rank 2 storage in the authenticator
  store.ts               local record store (memory + IndexedDB)
  enable.ts              provisioning, highest rank first
  unlock.ts              PRF / largeBlob / UV-gated local → Vault Key
```

## Flow

```
enableDeviceUnlock()   master password already unlocked the vault
  create credential (userVerification: "required", prf, largeBlob)
  rank 1 prf             assertion → PRF → HKDF → DWK → wrap random DK
  rank 2 large_blob      random BWK (local) wraps DK, envelope → authenticator
  rank 3 uv_gated_local  random LSK (local) wraps DK, envelope → local store
  → Device Envelope (VK under DK) is uploaded to the server

unlockWithDevice()     locked vault, no master password typed
  assertion (UV required, rpIdHash + UV flag verified)
  → DWK or stored wrapping key → DK → VK
```

Only the Vault Key survives a call. PRF output, DWK, DK, and stored wrapping
keys are zeroized by `@4allpass/crypto`'s device helpers.

## Rank 2 vs rank 3

`webauthn-prf.md` §5 ranks largeBlob above the local store because the
authenticator holds the material. This package splits it accordingly:

| Rank | Device-Key Envelope | Wrapping key |
|---:|---|---|
| 2 `large_blob` | authenticator largeBlob | local store |
| 3 `uv_gated_local` | local store | local store |

Rank 2 needs both halves, so a stolen local store alone is not enough. Rank 3 is
policy only, exactly as the spec documents it.

## Hard rules

- `userVerification` is always `"required"`, on create and on every assertion.
- An assertion is only trusted after `assertUserVerified` checks the rpIdHash,
  the UP flag, and the UV flag.
- `prf.results.first` shorter than 32 bytes is refused, never stretched.
- The local record never holds the Vault Key, the Master Key, or the Device Key.
- Only the PRF Device-Key Envelope may be mirrored to the server: unwrapping it
  requires a live assertion on that authenticator. Ranks 2 and 3 are wrapped
  under a locally held key and stay local.
- Failure always ends in `DeviceUnlockUnavailableError`, so the UI can offer the
  master password. Master-password unlock is never removed or blocked.

## Tests

```sh
npm test -w @4allpass/webauthn
```

`test/fake-authenticator.ts` implements the `WebAuthnClient` boundary with a
keyed-HMAC PRF, largeBlob storage, and a controllable UV flag, so the ranking,
the fallbacks, and the UV gate are covered without a browser.
