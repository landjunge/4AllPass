# `@4allpass/crypto`

Crypto Protocol v1 core. No UI, no network, no authenticator I/O.

```
src/
  index.ts              public API
  test-only.ts          nonce / raw-KDF hooks (KATs only)
  types.ts              KeyEnvelope, EncryptedEntry, DeviceKeyEnvelope
  constants.ts
  errors.ts
  encoding/
    aad.ts              length-prefixed AAD + envelope/entry/device builders
    bytes.ts
    unicode.ts          NFC → UTF-8
  kdf/
    profiles.ts         ci / mobile_safe / balanced / standard / high
    argon2id.ts         deriveMasterKey
  aead/
    aes-gcm.ts          encrypt (library nonce) / decrypt
  envelope.ts           wrapVaultKey / unwrapVaultKey (AAD version from the envelope)
  entry.ts              encryptEntry / decryptEntry (schemaVersion stored on the entry)
  device.ts             PRF eval.first, HKDF DWK, Device-Key Envelope
  device-unlock.ts      PRF wrap/unwrap with mandatory zeroize + fallback rank
  wire.ts               base64url JSON for server JSONB (no plaintext keys)
  revision.ts           evaluateRevision / rollback detection
  random.ts             CSPRNG helpers
  memory.ts             best-effort zeroize
```

## Hard rules

- Vault Key is always random. Never derived from the master password.
- Public `encrypt` / `wrapVaultKey` / `encryptEntry` **do not** take a nonce.
- Envelope AAD `crypto_version` is the envelope's own `version`, never a global default.
- `decryptEntry` reads `schemaVersion` / `cryptoVersion` from the entry.
- Raw WebAuthn PRF output is never used as a key; HKDF is mandatory.
- `wrapDeviceKeyFromPrf` / `unwrapDeviceKeyFromPrf` zeroize PRF output and DWK after use.
- Device unlock fallback rank is PRF > largeBlob > UV-gated local store. Master Password stays available.
- `ci` profile cannot be persisted unless `allowTestProfile: true`.
- Master password is NFC-normalized, then UTF-8.

## Tests

```sh
npm test                 # RFC + ci + AAD + envelopes + PRF/HKDF + revision
npm run test:crypto:heavy
```

Vectors live in `docs/test-vectors/*.json` and are the source of truth.
