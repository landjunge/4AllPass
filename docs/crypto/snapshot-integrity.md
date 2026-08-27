## 8.1 Snapshot Manifest (authenticated `revision`)

Per-object AEAD proves that each entry and envelope was not modified. It proves
nothing about *which set* of objects a snapshot contains, and nothing about the
`revision` number the server attaches to them. The manifest closes both gaps.

```ts
interface SnapshotManifest {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  cryptoProtocolVersion: number;
  entries: Array<{ id; schemaVersion; cryptoVersion; vaultKeyVersion; digest }>;   // digest = SHA-256 of the sealed entry
  envelopes: Array<{ type; deviceId; vaultKeyVersion; deviceKeyVersion; digest }>; // digest = SHA-256 of the sealed envelope
}
```

The manifest body is encoded canonically and sealed under the **Vault Key**:

```
frame(x…)        = for each field: uint32be(len) || bytes      // numbers are uint32be
body             = frame("4allpass-manifest-content-v1", vault_id, crypto_version,
                         revision, vault_key_version, entry_count, envelope_count)
                   || frame(entry_id, schema_version, crypto_version, vault_key_version, digest)*
                   || frame(type, device_id_or_empty, vault_key_version, device_key_version, digest)*
sealed manifest  = AES-256-GCM(VK, body, AAD = manifest AAD of §3.1)
```

Rules:

- Entries are sorted by `entry_id`, envelopes by `(type, device_id)`, comparing the
  **UTF-8 bytes** — not UTF-16 code units, which would order astral characters
  differently from the wire format. Ids are unique; a duplicate id or two envelopes
  for one device is an error. Canonical form matters because the manifest is the
  object being authenticated.
- A snapshot has **exactly one** `vault_key_version`. Every entry and envelope in it
  must carry that same value; a manifest that spans two generations is not
  representable.
- Digests cover the complete sealed object, including nonce, ciphertext, tag, all
  versions and (for master envelopes) the KDF parameter digest.

### Client verification order

1. Fetch the snapshot named by `active_revision`.
2. Obtain VK by unwrapping one envelope (Master, Device or Recovery) — against explicit
   expectations, §3.2.
3. `verifySnapshotManifest(sealed, { entries, envelopes }, { vaultKey, vaultId, revision, vaultKeyVersion })`.
   The GCM tag decides whether the server's claimed `revision` is real, the decoded
   body must agree with the AAD, and the snapshot must be exactly the declared set:
   no substitutions, nothing missing, nothing extra.
4. **Apply the records that verification returned**, not the ones that were passed in
   (§8.2).
5. Run the content integrity pass of §8.3 (`verifySnapshot` / `unlockSnapshot`): every
   entry must decrypt under that one Vault Key, and every other envelope the client can
   unwrap must yield the same one.
6. Only now compute the freshness decision (`evaluateRevision`) and pin the result
   with `revisionFromManifest(verified)`, which carries the digest of the blob that was
   actually authenticated. Passing a manifest and a sealed blob separately is not
   allowed: pinning the digest of an unverified blob would turn the equivocation check
   into noise — the honest snapshot would then be rejected as a fork.

### 8.2 Verify and use must see the same bytes

A digest only means something if the bytes that were digested are the bytes that get
decrypted. Two rules follow, and they are requirements on implementations, not
suggestions:

- **Read each field of an untrusted record exactly once**, into a normalized copy, and
  digest that copy. A record whose fields are accessors rather than data — the natural
  output of a JSON reviver, a lazily-decoding transport wrapper, or a model layer — can
  otherwise answer differently on a second read, presenting honest bytes to the checks
  and stale bytes to the digest. `Uint8Array` fields must be copied, since a `Proxy`
  over one passes every type and length check and can still change its bytes.
- **Hand the normalized records back to the caller** and require that those are the
  ones applied. Anything else re-opens the same gap one layer up:
  `verifySnapshotManifest(...)` returns `{ manifest, sealedDigest, entries, envelopes }` for
  exactly this reason.

Identifiers get the same treatment: a string containing an unpaired surrogate has no
UTF-8 encoding, and `TextEncoder` would silently replace it with U+FFFD — so
`"\uD800"`, `"\uDC00"` and `"\uFFFD"` would share one AAD and one digest preimage.
Since `vault_id` is server-supplied and is the only cryptographic separator between
vaults, ill-formed UTF-16 must be **rejected**, not encoded.

Finally, the framing of §8.1 is safe because every preimage has **fixed arity and a
fixed field order**: `frame()` encodes the number `1` and the four bytes
`00 00 00 01` identically, so an optional or variable-arity field would introduce a
genuine ambiguity. New fields therefore go at the end of a preimage, are never
optional, and a new preimage gets a new label.

---

## 8.3 Content integrity pass

The manifest proves *which records* belong to the snapshot. It does not prove that
they all decrypt: a client that holds VK for generation `v` and is handed a
manifest-consistent snapshot at generation `v` still has to establish that every
record really is under that one key. That is the pass specified in
`vault-revision.md` §6 and implemented as `verifySnapshot` / `unlockSnapshot`:

- every entry must decrypt under the Vault Key the client obtained, and
- every additional envelope the client can unwrap (e.g. the master envelope
  alongside a device envelope) must yield the **same** Vault Key.

A single failure rejects the whole snapshot with `IntegrityError`. A wrong wrapping
key (wrong Master Password) is *not* an integrity failure — it stays
`AuthFailureError`, because it is an ordinary, expected condition.

The two mechanisms are complementary and neither replaces the other:

| | Manifest (§8.1) | Content pass (§8.3) |
|---|---|---|
| Authenticates `revision` | yes | no |
| Detects records that are valid but not part of this snapshot | yes | no |
| Detects a dropped or injected record | yes | only if it fails to decrypt |
| Detects `VK₁` entries under `VK₂` envelopes | yes, structurally | yes, by decryption |
| Works on a snapshot published without a manifest | no | yes |
| Needs a wrapping key beyond VK | no | only for cross-checks |

Run the manifest check first where a manifest exists; the content pass is the only
available defence for snapshots that predate it.

What this catches that per-object AEAD does not:

| Server behaviour | Detected by |
|---|---|
| `revision = 50` attached to snapshot 42 | manifest AAD → `AuthFailureError` |
| Entries from revision 41 served with revision 42's metadata | digest set mismatch |
| An entry silently dropped (truncation) | declared count / digest set |
| An extra entry injected | digest set |
| A revoked device's envelope re-attached | envelope digest set |
| Two different snapshots served under one revision | pinned `manifestDigest` → `mismatch` |

Known-answer tests: **TV-MANIFEST-01**, **TV-TAMPER-REVISION**,
**TV-TAMPER-MANIFEST-KEY-VERSION**.

---
