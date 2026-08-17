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
    base64.ts           strict base64 for the JSON wire format
    bytes.ts
    unicode.ts          NFC → UTF-8
  kdf/
    profiles.ts         ci / mobile_safe / balanced / standard / high
    argon2id.ts         deriveMasterKey
  aead/
    aes-gcm.ts          encrypt (library nonce) / decrypt
  envelope.ts           wrapVaultKey / unwrapVaultKey (AAD version from the envelope)
  entry.ts              encryptEntry / decryptEntry (schemaVersion stored on the entry)
  device.ts             PRF eval.first, HKDF DWK, Device-Key Envelope,
                        bindDeviceWithPrfOutput / unwrapVaultKeyWithPrfOutput
  snapshot.ts           verifySnapshot / unlockSnapshot (vault-revision.md §6)
  revision.ts           evaluateRevision / rollback detection
  wire.ts               JSON encode/decode for server transport (strict)
  random.ts             CSPRNG helpers
  memory.ts             best-effort zeroize
```

## Hard rules

- Vault Key is always random. Never derived from the master password.
- Public `encrypt` / `wrapVaultKey` / `encryptEntry` **do not** take a nonce.
- Envelope AAD `crypto_version` is the envelope's own `version`, never a global default.
- `decryptEntry` reads `schemaVersion` / `cryptoVersion` from the entry.
- Raw WebAuthn PRF output is never used as a key; HKDF is mandatory.
- `bindDeviceWithPrfOutput` / `unwrapVaultKeyWithPrfOutput` zeroize the PRF
  output, the DWK, and the Device Key before returning. Only the Vault Key
  survives a device unlock.
- Envelopes decoded with `wire.ts` are validated structurally (lengths,
  versions, type/field combinations) because they come from an untrusted server.
- `ci` profile cannot be persisted unless `allowTestProfile: true`.
- Master password is NFC-normalized, then UTF-8.

## Tests

```sh
npm test                 # RFC + ci + AAD + envelopes + PRF/HKDF + revision
npm run test:crypto:heavy
```

Vectors live in `docs/test-vectors/*.json` and are the source of truth.
