# Adversarial Code Review — `packages/crypto` (v1)

**Status:** Review record, not a spec change  
**Companion to:** `crypto-protocol.md`, `threat-model.md`, `vault-revision.md`, `webauthn-prf.md`  
**Scope:** `packages/crypto/src/**` as of commit `ac9585b` (fix(protocol): close schemaVersion, PRF, and rollback gaps)  
**Method:** line-by-line source review + adversarial tests exercising the real public API (not just raw KAT vectors) in [`packages/crypto/test/adversarial.test.ts`](../packages/crypto/test/adversarial.test.ts)  
**Date:** 2026-08-17

This is the review the architecture review asked for next: stop evaluating the design on paper and instead try to break the implementation across a fixed list of bug classes, then check whether the test suite actually catches each one.

---

## 1. Method

For every category below, an adversarial test round-trips a **real** envelope/entry/device-key through the actual `wrap*`/`encrypt*` function, mutates exactly one field the way a malicious server, a malicious co-tenant device, or a malformed message would, and asserts the corresponding `unwrap*`/`decrypt*` function refuses it. This is stronger evidence than the existing `TV-TAMPER-*` vectors, which mostly call the raw `decrypt()` primitive with precomputed hex and therefore don't exercise the wiring inside `unwrapVaultKey`/`decryptEntry`/`unwrapDeviceKey` themselves.

Legend: ✅ caught (test added/passing) · 🔴 confirmed gap · 🟡 hardened during this review (was previously unvalidated) · ⚪ not applicable to this package.

---

## 2. Findings by category

| # | Category | Verdict | Where | Evidence |
|---|---|---|---|---|
| 1 | Nonce reuse | ✅ | `random.ts`, `aead/aes-gcm.ts` | Nonce is CSPRNG-generated inside the library; public `encrypt()` has arity 3 (no caller nonce parameter) — `nonce.test.ts`, `adversarial.test.ts` ("no nonce parameter to accidentally pass") |
| 2 | Version confusion (envelope/entry/device-key) | ✅ | `envelope.ts`, `entry.ts`, `device.ts` | Bumped `envelope.version` / `entry.cryptoVersion` / device-key `version` is rejected with `ProtocolError` before or independently of AEAD — 4 new tests in "Adversarial: version confusion" |
| 3 | AAD mismatch / generic tamper | ✅ | `encoding/aad.ts`, `aead/aes-gcm.ts` | Pre-existing `TV-TAMPER-*` KATs plus new full-API round-trips | 
| 4 | Cross-vault attacks | ✅ | `entry.ts`, `envelope.ts` | An entry/envelope sealed for vault A fails to decrypt when the caller supplies vault B's id — "Adversarial: cross-vault attacks" |
| 5 | Cross-device attacks | ✅ | `envelope.ts`, `device.ts` | A device envelope relabeled to another `deviceId`, or opened with another device's DK/DWK, fails — "Adversarial: cross-device attacks" |
| 6 | Key substitution | ✅ | `envelope.ts`, `entry.ts`, `device.ts` | Correct ciphertext + wrong key always fails, for all three unwrap paths — "Adversarial: key substitution" |
| 7 | Downgrade (`vaultKeyVersion`) | ✅ | `revision.ts` | `evaluateRevision` refuses a `vaultKeyVersion` decrease even when `revision` advances — `revision.test.ts`, reconfirmed in `adversarial.test.ts` |
| 8 | Rollback (`revision`) | ✅ / 🔴 (see §3) | `revision.ts` | Refused **at the metadata layer**. Metadata-level rollback is caught; **per-entry** rollback within one `vaultKeyVersion` epoch is not (§3) |
| 9 | Malformed input (bad lengths) | ✅ | `encoding/bytes.ts`, `aead/aes-gcm.ts`, `device.ts` | Wrong-length key/nonce/tag/PRF-output all raise `ProtocolError` before reaching the AEAD primitive — "Adversarial: malformed input / truncation" |
| 10 | Truncation / extension of ciphertext | ✅ | `aead/aes-gcm.ts` | Truncated or extended ciphertext is an `AuthFailureError`, not a crash or silent partial decrypt — 2 new tests |
| 11 | Credential swapping | ✅ / 🟡 | `device.ts`, `encoding/aad.ts` | Swapped `credentialId` on a Device-Key Envelope fails (AAD-bound). **Hardened:** `credentialId` can no longer be an empty `Uint8Array` (previously unvalidated — see §4.1) |
| 12 | PRF misuse | ✅ | `device.ts` | `prfOutput` must be exactly 32 bytes (`assertLength`); wrong lengths (0/16/31/33/64) all rejected — new test |
| 13 | HKDF misuse / domain separation | ✅ | `device.ts`, `encoding/aad.ts` | Independently varying `rpId`, `vaultId`, `deviceId`, `credentialId`, `cryptoVersion` each changes the DWK — previously only `vaultId` variation was tested; the other four dimensions are new coverage |
| 14 | Zeroization leaks | 🟡 fixed | `kdf/argon2id.ts` | `deriveMasterKey` allocated a UTF-8 copy of the Master Password internally and never scrubbed it, violating the documented Hard Invariant #4 ("zeroized as soon as possible after key derivation"). Fixed — see §4.2 |
| 15 | Test-only API leakage | ✅ | `index.ts`, `test-only.ts`, `package.json` | None of `encryptWithNonce` / `wrapVaultKeyWithNonce` / `encryptEntryWithNonce` / `wrapDeviceKeyWithNonce` / `deriveArgon2idRaw` is reachable from `@4allpass/crypto`'s main entry point; `package.json#exports` only maps `.` and `./test-only` — new test asserts this by introspecting the actual module namespace object |

---

## 3. 🔴 Confirmed gap: per-entry rollback within one `vaultKeyVersion` epoch

This reproduces, with a runnable proof, the review's central point: *"Was bindet `revision = 50` kryptografisch an den tatsächlichen Snapshot?"*

**Root cause.** `entryAad` (and `envelopeAad`) bind `vault_id`, `entry_id`/`type`, `schema_version`, and `crypto_version` — see `encoding/aad.ts`. They do **not** bind `revision` or `vault_key_version`. `evaluateRevision` (`revision.ts`) only compares the *metadata tuple* `(vaultId, revision, vaultKeyVersion)` the server hands over alongside a snapshot; it has no way to verify that the entries served with that metadata were actually sealed for that revision, because nothing in the ciphertext says so.

**Reproduction** (see `adversarial.test.ts`, describe block "downgrade & rollback", test "CONFIRMED GAP"):

1. Encrypt `entry_balance_note` at logical revision 5 → ciphertext `C5`.
2. Edit the entry; encrypt the same `entryId` again at logical revision 6 → ciphertext `C6` (different bytes, same `vaultId`/`entryId`/`schemaVersion`/`cryptoVersion`, same `vaultKeyVersion`).
3. Client's pinned state is `{revision: 5, vaultKeyVersion: 1}`. A malicious server announces `{revision: 6, vaultKeyVersion: 1}` — `evaluateRevision` returns `{ ok: true, action: "advance" }`.
4. The server actually serves `C5` (the *old* ciphertext) for that one entry, mixed in with genuine revision-6 data for everything else.
5. `decryptEntry(C5, vk, vaultId)` **succeeds** and returns the stale plaintext. No exception, no signal.

The client now believes it is looking at revision 6 (a state it explicitly accepted as fresh) while silently holding stale data for one entry, with no way to detect it from the crypto layer alone.

**Why this doesn't (yet) break confidentiality or integrity-of-the-whole.** A malicious server still cannot forge a *new* plaintext or move an entry across a `vaultKeyVersion` rotation undetected (§6 of `vault-revision.md` — mixing `VK_v` entries with `VK_{v+1}` envelopes fails on the first unwrap). The residual risk is narrower: **selective, silent replay of individual entries inside a single key epoch.**

**Recommended fix (matches the review's proposal).** Fold `revision` and `vault_key_version` into `entryAad` (and `envelopeAad`):

```
"4allpass-entry-v1" || vault_id || entry_id || schema_version_u32be || crypto_version_u32be || revision_u32be_or_u64be || vault_key_version_u32be
```

This is a **breaking AAD change** (every existing KAT and every already-sealed entry would need re-encryption under the new AAD), so it should land as a deliberate `crypto_protocol_version` bump with its own migration plan and KAT set, not a silent patch. An alternative with a smaller blast radius: keep entry AAD as-is, but require the *manifest* (`vault_id`, `revision`, `vault_key_version`, and a content hash/MAC over the entry id set) to itself be an authenticated object signed/MACed under a key the server cannot forge, and have the client verify that MAC before trusting `evaluateRevision`'s input at all. Either way, this is a protocol-level decision and is out of scope for a point fix in this review; it is recorded here so it isn't lost, and cross-referenced from `crypto-protocol.md` and `threat-model.md`.

**Test status:** now covered. The new adversarial test pins current behavior (decryption of stale-but-authentic data succeeds) so that any future fix is forced to update this test, turning "we said we'd fix it" into something CI actually tracks.

---

## 4. Fixes applied during this review

### 4.1 `credentialId` could be empty

`wrapDeviceKey`, `wrapDeviceKeyWithNonce`, `unwrapDeviceKey`, and `deriveDeviceWrappingKey` accepted `credentialId: Uint8Array` with no length check. An empty credential id is still unambiguous in the length-prefixed AAD/HKDF-info encoding (so it wasn't a parsing bug), but it collapses one of the five binding dimensions (`rpId`, `vaultId`, `deviceId`, `credentialId`, `cryptoVersion`) to a constant, which is exactly the kind of degenerate input adversarial review is supposed to catch before it becomes an integration bug upstream. Fixed in `device.ts`: all four entry points now reject an empty `credentialId` with `ProtocolError`.

### 4.2 `deriveMasterKey` never zeroized its internal password buffer

`crypto-protocol.md` §1 states Hard Invariant #4: *"The Master Password never leaves the client and is zeroized as soon as possible after key derivation."* `deriveMasterKey` (in `kdf/argon2id.ts`) took the caller's `password: string`, ran it through `utf8Nfc()` to get a fresh `Uint8Array`, and passed that to Argon2id — but never scrubbed that intermediate byte buffer afterwards. The JS string itself can't be zeroized (strings are immutable), but the UTF-8 copy is entirely owned by the library, created and discarded within a single call, so it is squarely the library's responsibility. Fixed with a `try/finally` that calls `zeroize()` on the buffer before `deriveMasterKey` returns, on both the success and the throw path.

This is verified in `adversarial.test.ts` by temporarily instrumenting `TextEncoder.prototype.encode` to capture the exact buffer `utf8Nfc` allocates, then asserting it is all-zero once `deriveMasterKey` returns — without exporting any internal buffer from the module.

---

## 5. Notes for the next review pass (not fixed here, flagged for follow-up)

These did not rise to the level of "confirmed gap" but are worth a second look once the recovery-key code exists:

- **`unwrapDeviceKey` trusts the envelope's own `vaultId`/`deviceId`/`credentialId` fields as ground truth** rather than accepting an externally expected identity to check against. In practice this degrades gracefully today: a substituted Device-Key Envelope from a different vault/credential context will fail to unwrap with the caller's real DWK anyway (DWK is itself bound to `vaultId`/`deviceId`/`credentialId`, per §13 of this table). But there is no *fail-fast, explicit* identity check independent of that fact — worth adding as defense in depth (`unwrapDeviceKey(envelope, dwk, { expectedVaultId, expectedDeviceId })`) so a future refactor can't accidentally remove the implicit protection.
- **Recovery envelope / Recovery Key strength and encoding are not implemented yet** — `wrapVaultKey({ type: "recovery" })` exists and is exercised by KATs, but there is no dedicated `recovery.ts` module, no BIP39/Base58 encoding, and no strength check on the Recovery Key analogous to `assertProductionKdf`. This is the review's own next-priority item (🟠 "Recovery und Rotation") and should get the same adversarial treatment once it lands: recovery-key entropy/strength, recovery-envelope AAD binding, and recovery-then-rotate flow.
- **`deviceKeyVersion` is not yet a first-class field.** Today only `vaultKeyVersion` exists in `VaultRevision`; a Device Key rotation (revoke-and-reissue DK for one device without touching VK) has no explicit version counter of its own. Matches the review's 🟠 third point.

---

## 6. Test inventory added by this review

All in [`packages/crypto/test/adversarial.test.ts`](../packages/crypto/test/adversarial.test.ts), run via `npm test` in `packages/crypto`:

- Cross-vault attacks (3 tests)
- Cross-device attacks (4 tests)
- Key substitution (3 tests)
- Version confusion (4 tests)
- Envelope type confusion (2 tests)
- Malformed input / truncation (7 tests)
- PRF / HKDF domain separation (6 tests)
- Downgrade & rollback, including the confirmed gap (3 tests)
- Zeroization (2 tests)
- Test-only API leakage (2 tests)

36 new tests, 0 failures against the fixed implementation. Full package suite: 98 tests (94 fast + 4 heavy-Argon2id, gated by `RUN_HEAVY=1`), 0 failures.
