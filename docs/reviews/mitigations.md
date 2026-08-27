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

---

## 5. Reconciliation with the parallel hardening on `main`

`main` hardened the same core independently (mixed-snapshot protection, KDF bounds,
error taxonomy, device version). Most of it composed directly. Three points were
genuine disagreements and were settled as follows.

### Two snapshot defences, both kept

`main` added `verifySnapshot` / `unlockSnapshot` (`snapshot.ts`): decrypt every entry
under the Vault Key and require every cross-checkable envelope to yield the *same*
Vault Key. This review added the sealed manifest. Both names collided; the manifest
function is now `verifySnapshotManifest`.

Keeping both is not indecision. The manifest authenticates the `revision` and the
exact set of records — a stale-but-authentic entry is caught even though it decrypts
fine. The content pass proves that everything really is under one key, needs no
manifest, and is therefore the only available defence for a snapshot published before
the manifest existed. `crypto-protocol.md` §8.3 states the division and the order.

### Error taxonomy: split on provenance, not on convenience

`main`'s M3 mapped wrong-length AEAD material to `AuthFailureError`, arguing that
callers catch that class for "corrupt or wrong key" and a `ProtocolError` there would
become an uncaught crash. F-08 above mapped malformed input to `ProtocolError`,
arguing that malformed is not the same as tampered. Both had tests asserting their own
answer on the *same* calls.

The resolution splits on who can cause the failure:

| Condition | Class | Why |
|---|---|---|
| Field is not a `Uint8Array` | `ProtocolError` | No remote attacker can produce this; it is the app's deserializer |
| Correctly-typed field of the wrong length | `AuthFailureError` | Attacker-controlled framing, and such a blob cannot authenticate |
| Well-formed but contradicts the caller, or snapshot ≠ manifest | `IntegrityError` | The signature of substitution |

F-08's actual complaint — a JSON-decoded array of numbers looking like tampering — is
still fixed, because that is the type case.

### KDF bounds

`main`'s ceilings are stricter (512 MiB rather than 1 GiB, plus floors on iterations
and lanes) and its `ARGON2_MAXMEM_BYTES` is a fixed backstop rather than a value
derived from the caller's `memory`, which is better. Those win. This review's salt
validation, well-formedness check and the normalizing `assertKdfBlock` (needed for
F-19) layer on top.

### What the merge itself found

`main`'s stricter frontend `tsconfig` (`erasableSyntaxOnly`, `noUnusedLocals`) rejected
two things in this branch's code that the crypto package's own config accepted: unused
imports left behind by the framing change, and a constructor parameter property in the
manifest parser. Both fixed. Worth noting for its own sake: the merge was a review too.
