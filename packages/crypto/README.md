# `@4allpass/crypto`

Crypto Protocol v1 core. No UI, no network, no authenticator I/O.

```
src/
  index.ts              public API
  test-only.ts          nonce / raw-KDF hooks (KATs only; throws in production builds)
  types.ts              KeyEnvelope, EncryptedEntry, DeviceKeyEnvelope, SnapshotManifest
  constants.ts          labels, sizes, bounds
  errors.ts             ProtocolError / IntegrityError / AuthFailureError / RollbackError
  validate.ts           untrusted-input validation and expectation checks
  encoding/
    aad.ts              length-prefixed AAD builders (envelope / entry / device / manifest)
    framing.ts          uint32be framing for digest preimages
    digest.ts           KDF-params, entry, envelope and sealed-manifest digests
    bytes.ts
    unicode.ts          NFC → UTF-8
  kdf/
    profiles.ts         ci / mobile_safe / balanced / standard / high + range checks
    argon2id.ts         deriveMasterKey (validates params from the envelope)
  aead/
    aes-gcm.ts          encrypt (library nonce) / decrypt, owned output buffers
  envelope.ts           wrapVaultKey / unwrapVaultKey (expectations required)
  entry.ts              encryptEntry / decryptEntry (expected entryId + vaultKeyVersion)
  device.ts             PRF eval.first, HKDF DWK, Device-Key Envelope, deviceKeyVersion
  manifest.ts           snapshot manifest: seal / open / verify (revision is authenticated)
  recovery.ts           Emergency-Kit encoding + Recovery Wrapping Key
  revision.ts           evaluateRevision / rollback, downgrade, equivocation
  random.ts             CSPRNG helpers
  memory.ts             best-effort zeroize
```

## Hard rules

- Vault Key is always random. Never derived from the master password.
- Public `encrypt` / `wrapVaultKey` / `encryptEntry` / `sealManifest` **do not** take a nonce.
- Versions are never defaulted: `vaultKeyVersion`, `deviceKeyVersion`, `schemaVersion` and `cryptoVersion` are stated by the writer and read back from the object.
- Every field is authenticated. AAD covers the KDF parameter digest and both key generations; metadata that does not belong to an envelope kind is rejected, not ignored.
- Opening is done against an expectation. AAD built from an object's own fields proves self-consistency, not identity.
- `revision` is only believed after the sealed manifest verifies; pins are built with `revisionFromManifest`.
- Raw WebAuthn PRF output is never used as a key; HKDF is mandatory, and an all-zero PRF result is refused.
- The printed Recovery Key is never used as an AES key; `deriveRecoveryWrappingKey` first.
- `ci` profile cannot be used unless `allowTestProfile: true` — on read as well as write.
- Master password is NFC-normalized, then UTF-8.

## Error semantics

| Error | Meaning |
|---|---|
| `ProtocolError` | malformed input: wrong type, wrong length, out of range, non-canonical |
| `IntegrityError` | well-formed input that contradicts the caller's expectation — the signature of substitution |
| `AuthFailureError` | the GCM tag did not verify |
| `RollbackError` | an incoming revision is older than the pinned one |

## Usage sketch

```ts
const vaultKey = generateVaultKey();

const master = wrapVaultKey({
  vaultKey, wrappingKey: masterKey, vaultId, type: "master",
  vaultKeyVersion: 1, kdf: kdfParamsFrom(ARGON2ID_PROFILES.standard, generateSalt()),
});

const entry = encryptEntry({ vaultKey, vaultId, entryId, vaultKeyVersion: 1, plaintext });

const manifest = buildManifest({ vaultId, revision: 1, vaultKeyVersion: 1,
                                 entries: [entry], envelopes: [master] });
const sealed = sealManifest({ vaultKey, manifest });

// …on the reading side, after fetching the snapshot:
const vk = unwrapVaultKey(master, {
  wrappingKey: deriveMasterKeyFromEnvelope(password, master),
  vaultId, expectType: "master", expectVaultKeyVersion: 1,
});
const verified = verifySnapshot(sealed, { entries, envelopes }, {
  vaultKey: vk, vaultId, revision: 1, vaultKeyVersion: 1,
});
assertFreshSnapshot(pin, revisionFromManifest(verified, sealed));
const plaintext = decryptEntry(entry, { vaultKey: vk, vaultId, entryId, vaultKeyVersion: 1 });
```

## Tests

```sh
npm test                 # KATs (AES-GCM, Argon2id, PRF, manifest, recovery) + adversarial suite
npm run test:crypto:heavy
npm run typecheck
```

Vectors live in `docs/test-vectors/*.json` and are the source of truth; they are
produced by `scripts/generate-vectors.mjs`, which does not import this package.

`test/adversarial-*.test.ts` covers nonce reuse, version confusion, AAD mismatch,
cross-vault, cross-device, key substitution, downgrade, rollback, malformed input,
truncation, credential swapping, PRF misuse, HKDF misuse, zeroization leaks and
test-only API leakage. Findings behind those tests: `docs/adversarial-review.md`.
