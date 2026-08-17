# Adversarial Code Review — `packages/crypto` (v1)

**Scope:** every file under `packages/crypto/src`, reviewed as an attacker with a
malicious server and a hostile local store, not as a reader of the specification.
**Date:** 2026-08-17
**Companions:** `crypto-protocol.md`, `vault-revision.md`, `webauthn-prf.md`, `recovery.md`, `threat-model.md`

The method was deliberately not "read the spec and check the code against it".
Every finding below was first **reproduced as a working attack** against the
implementation, then fixed, then pinned by a test that fails if the fix is
reverted. The tests are grouped by attack class so the mapping is checkable:

| File | Attack classes |
|---|---|
| `test/adversarial-aead.test.ts` | nonce reuse, AAD/digest ambiguity, AAD mismatch, truncation, malformed input, zeroization leaks, test-only API leakage |
| `test/adversarial-identity.test.ts` | entry substitution, cross-vault, cross-device, credential swapping, key substitution, version confusion |
| `test/adversarial-freshness.test.ts` | rollback, snapshot mix-and-match, truncation/injection of records, revoked-device replay, equivocation, key-generation downgrade, pin poisoning |
| `test/adversarial-kdf-prf.test.ts` | PRF misuse, HKDF misuse, KDF parameter downgrade and resource exhaustion |
| `test/adversarial-toctou.test.ts` | time-of-check/time-of-use on records and the KDF block, identifier collisions through ill-formed UTF-16, pin desynchronization, hostile container shapes, error taxonomy |

---

## 1. Findings

Severity is about what an attacker gains, not about how hard the fix was.

### F-01 — `revision` was not a cryptographic statement · **high** · fixed

`VaultRevision` and `evaluateRevision()` were pure policy over numbers the server
supplied. Nothing tied `revision = 50` to the bytes served with it, so a server
could pair any revision number with any snapshot, or hold `revision` fixed while
swapping content underneath it.

**Fix:** a **sealed snapshot manifest** (`manifest.ts`). It is encrypted under the
Vault Key with `vault_id`, `crypto_version`, `revision` and `vault_key_version` in
the AAD, and its body commits to a SHA-256 digest of every entry and every
envelope in the snapshot. A server that lies about the revision cannot produce a
manifest that verifies under it, and a server that mixes records from two
snapshots fails the digest comparison.

**Why not `revision` in the entry AAD** (the other option in the review): the
revision changes on *every* write, so binding it into each entry's AAD would force
re-sealing every entry of the vault on every single edit — O(N) crypto and O(N)
upload per password change. `vault_key_version` does not have that problem
(entries are re-sealed on rotation anyway), so that one *is* now in the entry AAD.
The manifest covers freshness for the whole snapshot at O(1) cost per write.

Tests: `refuses a manifest replayed under a newer revision number`, `refuses
entries from an older snapshot mixed into the current revision`, `TV-TAMPER-REVISION`.

### F-02 — Self-referential AAD on every open path · **high** · fixed

The AAD was built from the fields of the object being opened. That proves the
fields were sealed *together*; it says nothing about whether they are the fields
the caller asked for. Three exploitable cases, all reproduced:

- `unwrapDeviceKey(envelope, dwk)` took its `vaultId`, `deviceId` and
  `credentialId` from the envelope itself. A Device-Key Envelope belonging to
  another vault, another device or another credential unwrapped successfully.
- `decryptEntry(entry, vaultKey, vaultId)` took `entry.id` from the record, so a
  server could serve entry X's sealed record in the slot the client had requested
  for entry Y, and the client would show X's plaintext as Y.
- `unwrapVaultKey()` had no notion of which envelope kind the caller intended to
  open.

**Fix:** the open paths now take the caller's expectation and compare it before
decrypting: `unwrapVaultKey(envelope, { expectType, expectVaultKeyVersion,
expectDeviceId, expectDeviceKeyVersion, … })`, `decryptEntry(entry, { entryId,
vaultKeyVersion, … })`, `unwrapDeviceKey(envelope, { vaultId, deviceId,
credentialId, deviceKeyVersion, … })`. A mismatch is an `IntegrityError` before
any key touches the ciphertext.

Tests: `refuses a Device-Key Envelope minted for another vault, even with its
matching DWK`, `refuses entry X served in the slot the caller asked entry Y for`,
`refuses an envelope opened as a different kind than the caller asked for`.

### F-03 — Argon2id parameters were unauthenticated · **high** · fixed

The master envelope carried `kdf` (algorithm, cost parameters, salt) outside the
AAD. A server could rewrite the salt or weaken memory/iterations/lanes and the GCM
tag still verified.

**Fix:** the envelope AAD now contains `SHA-256` of a canonical encoding of the
KDF block (`kdfParamsDigest`). Any change to any parameter, including the salt,
breaks the tag.

Tests: `refuses a master envelope whose KDF salt was swapped`, `refuses a master
envelope whose KDF cost parameters were weakened`, `TV-TAMPER-KDF-PARAMS`,
`TV-TAMPER-KDF-SALT`.

### F-04 — KDF parameters were never validated on the read path · **high** · fixed

`deriveMasterKeyFromEnvelope()` fed server-controlled numbers straight into
Argon2id. `assertProductionKdf()` existed but ran only when *writing* an envelope.
Consequences: `memory` was an unbounded remote allocation request (a
denial-of-service primitive against the client), and a `ci`-profile envelope was
accepted on a production unlock path.

**Fix:** `assertKdfBlock()` runs on read as well as write, with a production floor
(32 MiB) *and* hard ceilings (`KDF_MEMORY_KIB_MAX` 1 GiB, 16 iterations, 16 lanes),
strict salt sizes (16 or 32 bytes), and exact checks on variant, Argon2 version and
output length. The test-only `ci` profile now requires an explicit
`allowTestProfile: true` on both paths.

Tests: `refuses a hostile envelope that asks for an absurd amount of memory`,
`refuses a hostile envelope that asks for a weak KDF`, `refuses to open a
ci-profile envelope on a production path`.

### F-05 — Metadata that did not belong to an envelope kind was ignored, not rejected · **medium** · fixed

`deviceId` on a master envelope and `kdf` on a device or recovery envelope were
silently dropped on read. Ignored fields are unauthenticated fields: anything a
higher layer later reads from them is attacker-controlled.

**Fix:** one shape rule per envelope kind, enforced identically on write and read
(`resolveFields`), plus rejection of any `type` that is not one of the three kinds
— including `__proto__`-style strings.

Tests: `refuses metadata injected into envelopes that must not carry it`,
`refuses an envelope type that is not one of the three kinds`.

### F-06 — No key-generation binding · **medium** · fixed

Neither the Vault-Key generation nor the Device-Key generation appeared in any
AAD, and there was no `deviceKeyVersion` at all. A stale envelope from an earlier
generation was cryptographically indistinguishable from the current one; the
client only noticed later, as an unexplained authentication failure.

**Fix:** `vaultKeyVersion` is now a required field on `KeyEnvelope`,
`EncryptedEntry` and the manifest, and is in all three AADs. `deviceKeyVersion` is
a required field on `DeviceKeyEnvelope` and on device-type `KeyEnvelope`s, and is
in the device-key and envelope AADs. Rotation of a Device Key is therefore
expressible, and rolling it back is detectable.

Tests: `refuses a Device Envelope wrapped under an older Device Key generation`,
`refuses an entry from another vault key generation`, `TV-TAMPER-VAULT-KEY-VERSION`,
`TV-TAMPER-DEVICE-KEY-VERSION`.

### F-07 — Ciphertext and tag shared one buffer · **medium** · fixed

`splitCiphertextTag()` returned `subarray` views into the buffer noble returned.
So `entry.ciphertext` and `entry.tag` aliased the same `ArrayBuffer` at different
offsets, and `entry.ciphertext.buffer.byteLength` was larger than the view. Two
practical consequences: zeroizing the ciphertext also overwrote the tag, and any
serializer that looks at `.buffer` instead of `(byteOffset, length)` would emit or
mix the wrong bytes.

**Fix:** `encryptWithNonce()` returns owned copies of `nonce`, `ciphertext` and
`tag`, and wipes the intermediate sealed buffer. The caller's nonce is copied too,
so mutating it afterwards can no longer desynchronize a stored nonce from its tag.

Tests: `hands out independent buffers for nonce, ciphertext and tag`, `zeroizing
the ciphertext does not silently rewrite the tag`, `copies the caller nonce so a
later mutation cannot desynchronize it`.

### F-08 — Malformed input was reported as an authentication failure · **low** · fixed

Nothing checked that byte fields were actually `Uint8Array`s. A snapshot that had
been through `JSON.parse` (arrays of numbers) reached AES-GCM and failed with
`AuthFailureError` — which reads as "someone tampered with your vault" instead of
"this data was deserialized wrong". Non-integer, negative, `NaN`, `Infinity` and
string versions were equally undiagnosed.

**Fix:** `validate.ts` with a deliberate split by *who can cause the failure* —
`ProtocolError` for input malformed in a way no remote attacker can produce
(wrong type, out of range, non-canonical), `AuthFailureError` for a failed tag
*and* for wrong-length AEAD material from an untrusted blob, and `IntegrityError`
for well-formed input that contradicts the caller. Identifiers are bounded
(non-empty, ≤ 256 UTF-8 bytes), credential ids are bounded (16…1023 bytes),
version numbers must be uint32 ≥ 1.

The length half of that split came out of the merge with `main`'s M3 hardening,
which had made the opposite call for framing errors; see §5.

Tests: the whole `attack: malformed input` block.

### F-09 — `revision` was unbounded, so the pin could be poisoned · **low** · fixed

`Number.isInteger` accepted `revision = Number.MAX_SAFE_INTEGER`. A hostile server
only had to answer once with an absurd revision on a fresh client: the client
pinned it, and every honest snapshot afterwards looked like a rollback — a
permanent, self-inflicted denial of service.

**Fix:** `revision` and `vaultKeyVersion` are bounded to the uint32 range they are
encoded in, `cryptoProtocolVersion` is bounded by what the client implements, and
`revisionFromManifest()` is the intended way to build a pin — from a manifest that
has already been verified under the Vault Key.

Tests: `refuses a pin poisoned beyond the uint32 revision range`, `refuses to
reason about a pin written by a newer client`.

### F-10 — Server equivocation on one revision was invisible · **medium** · fixed

`evaluateRevision()` returned `same` whenever the numbers matched, so a server
could serve two different snapshots under one revision number (for example, one
client's write silently dropped) and no client would notice.

**Fix:** `VaultRevision` carries an optional `manifestDigest`. When two answers for
the same revision carry different manifest digests, the decision is `mismatch`
with an explicit equivocation message.

Test: `detects a server that serves two different snapshots for one revision`.

### F-11 — Revoked device envelopes and dropped entries were undetectable · **medium** · fixed

Per-object AEAD says nothing about *which set* of objects belongs to a snapshot.
A server could re-attach the envelope of a revoked device, drop entries
(truncation) or inject extra records, and every individual object still verified.

**Fix:** the manifest commits to the complete set;
`assertSnapshotMatchesManifest()` refuses missing, extra or substituted records,
duplicate entry ids, duplicate envelopes for one device, and any snapshot whose
records span two Vault-Key generations.

Tests: `refuses a revoked device envelope re-attached to a later snapshot`,
`refuses a snapshot with an entry silently dropped`, `refuses an entry injected
into a verified snapshot`.

### F-12 — Weak-input handling in the PRF path · **low** · fixed

An authenticator (or a mis-wired fallback) that returns 32 zero bytes as the PRF
result would have produced a publicly computable Device Wrapping Key. Empty
`rpId` / `deviceId` / `credentialId` were also accepted, which removes the binding
those fields exist for.

**Fix:** all-zero PRF output is rejected, identifiers must be non-empty, and
credential ids must be at least 16 bytes.

Tests: `refuses an all-zero PRF result from a non-PRF authenticator`, `refuses
empty identifiers in the PRF context`, `refuses an empty or implausibly short
credentialId`.

### F-13 — Unbounded loops from declared counts · **low** · fixed (new code)

The manifest parser is the first place in this package that reads a
length-prefixed structure from untrusted bytes. Declared counts are bounded
(`MANIFEST_ENTRIES_MAX`, `MANIFEST_ENVELOPES_MAX`), strings are decoded with a
fatal UTF-8 decoder, digests must be exactly 32 bytes, trailing bytes are an
error, and the canonical form (sorted, unique, one key generation) is enforced so
that two encodings of "the same" manifest cannot exist.

Tests: `refuses a manifest body with trailing bytes`, `refuses a truncated
manifest body`, `refuses a duplicated entry id`.

### F-14 — Test-only surface · **low** · mitigated

`encryptWithNonce`, `wrapVaultKeyWithNonce`, `encryptEntryWithNonce`,
`wrapDeviceKeyWithNonce` and `sealManifestWithNonce` exist for the known-answer
tests. They are reachable only through the `@4allpass/crypto/test-only` subpath
(the package `exports` map blocks deep imports), the public entry point exports
nothing whose name ends in `WithNonce`, and importing the module in a build where
`NODE_ENV === "production"` throws.

That guard is a tripwire, not a boundary: a bundler that does not define
`NODE_ENV` will not trip it. Application code must not import the subpath, and the
test asserting the guard exists so the tripwire itself cannot rot.

Tests: `keeps nonce-accepting helpers out of the package entry point`, `refuses to
be imported in a production build`.

---

## 1.1 Second pass — findings in the code this review added

The fixes above introduced new attack surface (a length-prefixed parser, a Base32
decoder, a new pin field). Reviewing that surface with the same method turned up
four more issues, all fixed:

### F-15 — The manifest parser silently re-sorted records · **medium**

`decodeManifest` handed its output to `validateManifest`, which sorts. So a manifest
whose records were *not* in canonical order decoded fine, meaning two different byte
strings decoded to the same manifest. Only a holder of VK can seal a manifest, but
plaintext malleability under an authenticated encryption layer is still a footgun:
it makes "the manifest for revision N" ambiguous, and the pinned digest is over the
sealed bytes. Canonical order is now required on the wire (`assertSorted`).

### F-16 — Digests were computed before the byte fields were checked · **low**

`buildManifest` called `entryDigest()` / `envelopeDigest()` first and validated
afterwards. A digest over a malformed record is a perfectly valid commitment to
garbage, and `frame()` accepted anything with a `length` property. `frame()` now
rejects non-`Uint8Array` fields, and `buildManifest` checks nonce/ciphertext/tag
sizes (including the exact 32-byte wrapped-key size) before digesting.

### F-17 — The manifest comparison could be dropped after pinning · **medium**

`evaluateRevision` only compared manifest digests when *both* states had one. A
server that answered with unverified state (no digest) for a revision the client had
pinned *with* a verified manifest therefore got a plain `same` — the equivocation
check could simply be omitted. Missing digest on the incoming side is now a
`mismatch`.

### F-18 — Untrusted byte fields were read twice · **low**

Each open path validated `envelope.nonce` and then passed `envelope.nonce` to
`decrypt` again. For a plain object that is identical; for an object with getters (or
a Proxy) it is a time-of-check/time-of-use gap. Every open path now captures the
validated buffer and uses that value. The regression test asserts the getter is
invoked exactly once.

---

## 1.2 Third pass — an independent review of the new code

The manifest, the Base32 decoder and the new pin field were then reviewed
independently, by someone who had not written them and worked only from the
specification and the threat model. That pass found five more issues, one of which
defeated the manifest completely. All are fixed, and each has a regression test in
`test/adversarial-toctou.test.ts`.

### F-19 — The manifest committed to a *second read* of each record · **high**

`buildManifest` validated each record field by field and then handed the same object
to `entryDigest()` / `envelopeDigest()`, which read every field again. Measured with a
counting `Proxy`, every field was read exactly twice. So a record whose fields are
accessors rather than data could show honest bytes to the validation and stale bytes
to the digest — and a stale-but-authentic entry then passed `verifySnapshotManifest` and
decrypted to a password the user had already rotated away from. The envelope variant
re-attached a revoked device's envelope to a verified snapshot.

This is worth being blunt about: it defeated the exact guarantee F-01 was added for,
against a purely remote attacker, and it was introduced by the fix for F-18 covering
only the *open* paths and not the *digest* path. Accessor-backed records are not
exotic — a JSON reviver, a lazily-decoding transport wrapper, or an ORM-style model
layer all produce them.

The fix has two halves, because normalizing internally is not sufficient on its own:

1. `buildManifest` reads every field of every record exactly once into a normalized
   copy — including a copy of each `Uint8Array` (a `Proxy` over one satisfies
   `instanceof` and `length` and can still change its bytes) and of the KDF block —
   and digests that copy.
2. `verifySnapshotManifest` **returns** those normalized records, and the protocol now requires
   the caller to apply them. Otherwise the same gap simply moves one layer up: the
   library verifies its copy while the application decrypts its own.

The regression test tunes the attacker's read counter across the whole plausible range
and asserts the invariant directly: whatever verification accepts, the records it
returns are the records it digested.

### F-20 — Ill-formed UTF-16 identifiers collapsed two vaults into one · **medium**

`assertId` checked type, emptiness and a byte ceiling, but not well-formedness.
`TextEncoder` replaces every unpaired surrogate with U+FFFD, so `"\uD800"`,
`"\uDC00"` and `"\uFFFD"` are three distinct JS strings with one UTF-8 encoding —
and therefore one AAD, one digest preimage, one DWK and one RWK. Since `vault_id` is
server-supplied and is the only cryptographic separator between vaults, a server that
issued colliding ids could splice one vault's envelopes and entries into another
vault's session, with every `!==` check passing because the strings genuinely differ.
There was also a self-inflicted denial of service: such an id survived `buildManifest`
but was rewritten by the manifest round-trip, so the client could not open its own
vault, and the failure was reported as a tampering alarm.

`utf8()` now refuses strings with unpaired surrogates, which covers every AAD, digest
and HKDF path at once.

### F-21 — The pinned manifest digest could be desynchronized · **medium**

`revisionFromManifest(manifest, sealed)` took two independent arguments and never
checked that `sealed` was the blob `manifest` came out of. Pinning the digest of an
unverified blob does not fail loudly — it inverts the equivocation check: the honest
snapshot is thereafter rejected as a fork while a digest of the attacker's choosing is
blessed. `openManifest` now returns `{ manifest, sealedDigest }` as one value and
`revisionFromManifest` takes that, so the two cannot be paired incorrectly.

### F-22 — Hostile container shapes escaped as raw `TypeError` · **low**

`verifySnapshotManifest` with a sparse `entries` array (a JSON hole), an array-like object or
`null` threw a bare `TypeError`. An application that catches `CryptoError` to tell
tampering from bugs would take that as an unhandled crash, and the server controls the
JSON that produces it. `assertRecordList` now requires a dense array of objects.

### F-23 — Genuine tampering reported as `ProtocolError` · **low**

The library documents `ProtocolError` as "malformed" and `IntegrityError` as "the
signature of a substitution attack", but four server-controlled actions landed on the
wrong side of that line: an entry served twice, a corrupted envelope `type`, a
truncated envelope ciphertext, and a byte field arriving as a JSON array. A client
that retries on `ProtocolError` and alarms only on `IntegrityError` would have treated
a duplicate-entry injection as a sync glitch. Everything reached through
`assertSnapshotMatchesManifest` is server-supplied, so failures there are now
`IntegrityError`.

### Two structural notes from the same pass, not bugs

- Canonical manifest order was defined by UTF-16 code-unit comparison while the wire
  format is UTF-8, so a second implementation sorting bytes would have had its manifest
  rejected as non-canonical (reproducible with ids `U+10000` and `U+FF3A`). Ordering is
  now defined on UTF-8 bytes.
- `frame()` encodes the number `1` and the four bytes `00 00 00 01` identically, and an
  entry record and a device-envelope record in the manifest body share a five-field
  shape. Neither is exploitable, because every preimage has fixed arity and the record
  counts live inside the sealed plaintext — but that is exactly the invariant a v2 could
  break by accident, so it is now written down in `crypto-protocol.md` §8.2.

What that pass probed and found sound is worth recording too: nonce uniqueness over
20 000 seals, prefix-freedom of all eleven AAD builders, the manifest parser against
length-field overflow, unbounded counts, truncation, invalid and overlong UTF-8, and a
maximal 7 MB body, the Base32 encoding over 20 000 random keys and all 256 one-hot
keys, the KDF bounds, and an exhaustive search of all 324 revision state pairs over
three revisions × two key versions × three digest states.

---

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

## 4. What this review changed in the specification

- `crypto-protocol.md` §3.1 — the three AAD field lists, the KDF parameter digest,
  and the nonce budget per key.
- `crypto-protocol.md` §8.1 and `vault-revision.md` §3–§7 — the sealed manifest,
  the client verification order, and the backend's atomic-publication duty.
- `crypto-protocol.md` §8.2 — read-once normalization, applying the records that
  verification returned, rejecting ill-formed UTF-16 identifiers, and the fixed-arity
  invariant that makes the digest framing unambiguous.
- `webauthn-prf.md` §4 — `deviceKeyVersion` and Device-Key rotation.
- `recovery.md` (new) — Emergency-Kit encoding and the Recovery Wrapping Key.
- `test-vectors.md` — regenerated hex, 16 tamper vectors, manifest and recovery
  vector files.

Vectors are produced by `scripts/generate-vectors.mjs`, which implements the AAD
encoder, the framing, the manifest encoding and Crockford Base32 independently of
`packages/crypto` and seals with `node:crypto`. Generating them from the library
under test would have turned known-answer tests into snapshots of the code.
