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
- `ci` profile cannot be persisted unless `allowTestProfile: true`.
- Master password is NFC-normalized, then UTF-8, and zeroized after derivation.
- KDF params read from an envelope are untrusted: `deriveMasterKeyFromEnvelope`
  enforces floor **and** ceilings (memory ≤ 1 GiB, t ≤ 32, p ≤ 16) before running Argon2id.
- The library only writes protocol v1: `encryptEntry` / `wrapVaultKey` /
  `wrapDeviceKey` reject any other `cryptoVersion`.

## Tests

```sh
npm test                 # RFC + ci + AAD + envelopes + PRF/HKDF + revision + adversarial
npm run test:crypto:heavy
```

`test/adversarial.test.ts` models a malicious server: cross-vault / cross-device
swapping, envelope type confusion, entry renaming, truncation, credential
swapping, version confusion, hostile KDF parameters.

Vectors live in `docs/test-vectors/*.json` and are the source of truth.
