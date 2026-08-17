# `@4allpass/crypto`

Crypto Protocol v1 core. No UI, no network, no WebAuthn.

```
src/
  index.ts              public API
  test-only.ts          nonce / raw-KDF hooks (KATs only)
  types.ts              KeyEnvelope, EncryptedEntry, profiles
  constants.ts
  errors.ts
  encoding/
    aad.ts              length-prefixed AAD + envelope/entry builders
    bytes.ts
    unicode.ts          NFC → UTF-8
  kdf/
    profiles.ts         ci / mobile_safe / balanced / standard / high
    argon2id.ts         deriveMasterKey
  aead/
    aes-gcm.ts          encrypt (library nonce) / decrypt
  envelope.ts           wrapVaultKey / unwrapVaultKey
  entry.ts              encryptEntry / decryptEntry
  random.ts             CSPRNG helpers
  memory.ts             best-effort zeroize
```

## Hard rules

- Vault Key is always random. Never derived from the master password.
- Public `encrypt` / `wrapVaultKey` / `encryptEntry` **do not** take a nonce.
- `ci` profile cannot be persisted unless `allowTestProfile: true`.
- Master password is NFC-normalized, then UTF-8.

## Tests

```sh
npm test                 # RFC + ci + AAD + envelopes (skips 32–128 MiB)
npm run test:crypto:heavy
```

Vectors live in `docs/test-vectors/*.json` and are the source of truth.
