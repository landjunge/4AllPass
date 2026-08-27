## 2. Checked and found sound

Not everything reviewed was broken. These were probed and held:

- **Nonce ownership.** No public API accepts a nonce; every seal draws 96 fresh
  bits from `crypto.getRandomValues`. The test suite also documents *why* by
  showing that a reused key+nonce pair leaks the XOR of the two plaintexts.
- **AAD encoding.** Length-prefixed fields (`uint16be(len) || bytes`) with no
  ambiguous concatenation; empty optional fields are `00 00`, versions are
  uint32be. Digest preimages use a separate uint32be framing precisely because
  entry ciphertexts can exceed the 65 535-byte AAD field limit.
- **HKDF domain separation.** `rpId`, `vaultId`, `deviceId`, `credentialId` and the
  crypto version all change the DWK; the recovery derivation lives in its own
  label space, so the same 32 bytes used as PRF output and as a Recovery Key
  produce unrelated keys.
- **Argon2id known-answer tests** still match the reference C library
  (`scripts/verify-argon2id-vectors.py`, argon2-cffi) including the RFC 9106
  vector with secret and associated data.
- **`equalBytes`** is length-checked and branch-free over the payload; identity
  comparisons use it rather than `===` on decoded strings of bytes.

---

## 3. Residual risks (not fixed here, on purpose)

| Risk | Why it stays |
|---|---|
| Pin-on-first-use | A brand-new client has nothing to compare against; an active server still chooses which historical snapshot it sees first. Manifest verification makes that snapshot internally consistent, not fresh. |
| Backend atomicity | The client can now *detect* a mixed snapshot, but only the backend can prevent one. The commit protocol (write the full snapshot, then CAS `active_revision`) is a backend requirement, specified in `vault-revision.md` §4. |
| Availability | A malicious server can always withhold the newest snapshot. Detection ≠ prevention. |
| Memory disclosure | `zeroize` is best effort. JS/WASM cannot guarantee that every copy of a key is erased. |
| No browser/WebAuthn integration test | `packages/crypto` deliberately never talks to an authenticator; PRF is exercised with fixed stand-in output. An end-to-end test with a virtual authenticator belongs to the app layer and is still open. |
| Protocol-version downgrade branch | `evaluateRevision` refuses a `cryptoProtocolVersion` that goes backwards, but with only v1 defined the branch is unreachable today; it exists so that adding v2 does not require remembering it. |

---
