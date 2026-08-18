# 4AllPass Vault Revision & Atomic Rotation (v1)

**Status:** Authoritative for sync and hard revocation  
**Companion to:** `crypto-protocol.md` §7, `threat-model.md`  
**Date:** 2026-08-17

AES-256-GCM tells the client that a snapshot was not *modified*.  
It does **not** tell the client that a snapshot is the *latest*.

A malicious or crashed server can therefore:

- replay an older authentic vault (rollback),
- serve a mix of VK₁ entries and VK₂ envelopes,
- apply a rotation only halfway.

This document defines the snapshot model that closes those cases.

---

## 1. Identifiers

| Field | Meaning |
|---|---|
| `vault_id` | Stable vault identifier |
| `revision` | Monotonic snapshot number, integer ≥ 1, +1 on every committed write |
| `vault_key_version` | Monotonic Vault-Key generation, integer ≥ 1, +1 **only** on hard rotation |
| `crypto_protocol_version` | Protocol version of this snapshot (`1`) |

A **normal edit** increments `revision` and leaves `vault_key_version` unchanged.  
A **rotation** increments both.

---

## 2. Snapshot

The server’s unit of storage and of sync is an **immutable snapshot**:

```
VaultSnapshot
├── vault_id
├── revision
├── vault_key_version
├── crypto_protocol_version
├── envelopes[]          // all current Master / Device / Recovery envelopes
├── entries[]            // all EncryptedEntry values under this VK
└── manifest             // sealed under VK; authenticates all of the above
```

The server also stores a single pointer:

```
active_revision
```

Clients **only** fetch the snapshot named by `active_revision`.

There is no “current envelopes + current entries” assembled from different revisions.

### 2.1 The manifest is what makes the numbers real

`revision`, `vault_key_version` and the entry/envelope list are all supplied by the
server. On their own they are claims. The **sealed manifest** turns them into
statements only the holder of the Vault Key can make:

```
manifest AAD  = "4allpass-manifest-v1" || vault_id || crypto_version || revision || vault_key_version
manifest body = digest of every entry and every envelope in this snapshot
sealed        = AES-256-GCM(VK, body, manifest AAD)
```

Format and rules: `crypto-protocol.md` §8.1. Consequences for this document:

- A server cannot re-label snapshot 42 as revision 50: the AAD is part of the tag.
- A server cannot serve revision 42's metadata with revision 41's entries: the
  digests do not match.
- A server cannot quietly drop an entry or re-attach a revoked device's envelope:
  the manifest declares the complete set.
- Two different snapshots under one revision number are detectable, because the
  client pins the digest of the sealed manifest it accepted.

---

## 3. Client freshness check

The client pins the last accepted `(vault_id, revision, vault_key_version, crypto_protocol_version, manifest_digest)`.

`evaluateRevision(lastSeen, incoming)`:

| Incoming vs last seen | Decision |
|---|---|
| no pin yet | `first_seen` — accept and pin |
| same revision **and** same `vault_key_version` **and** same manifest digest | `same` |
| higher revision, same `vault_key_version` | `advance` |
| higher revision **and** higher `vault_key_version` | `rotation` |
| lower revision | **`rollback` — refuse** |
| lower `vault_key_version` | **`downgrade` — refuse** |
| lower `crypto_protocol_version` | **`downgrade` — refuse** |
| same revision, different `vault_key_version` | **`mismatch` — refuse** |
| same revision, different manifest digest | **`mismatch` — refuse (server equivocation)** |
| different `vault_id` | **`mismatch` — refuse** |

Implemented in `@4allpass/crypto` as `evaluateRevision` / `assertFreshSnapshot`.  
A refused snapshot must not be decrypted into the unlocked vault.

### 3.1 Verify before you pin

Order matters. The pin is the client's only memory of the past, so it must never be
written from numbers the server merely asserted:

```
1. fetch snapshot at active_revision
2. unwrap an envelope → VK                 (against explicit expectations)
3. verified = verifySnapshotManifest(sealed, contents, claimed metadata)
                                           → revision and the record set are authenticated
4. apply verified.entries / verified.envelopes, not the fetched objects
5. evaluateRevision(pin, revisionFromManifest(verified))
6. on accept: store that pin locally
```

Step 4 is not cosmetic. Verification commits to the bytes it read; if the client then
applies its own copy of the snapshot, anything that can make a second read return
something else (an accessor, a lazily-decoding wrapper) puts a stale record back into
the vault after the check passed. `revisionFromManifest` likewise takes the whole
verification result, so the pinned digest can only ever be the digest of the blob that
was authenticated.

`revision` and `vault_key_version` are bounded to the uint32 range they are encoded
in. Without that bound, a single hostile answer to a fresh client (`revision =
2^53 - 1`) would poison the pin permanently: every honest snapshot afterwards would
look like a rollback. `cryptoProtocolVersion` is bounded by what the client
implements, and a pin written by a *newer* client makes an older client refuse to
proceed instead of silently downgrading.

Pin-on-first-use is intentional: a brand-new client has no prior revision. After the first successful unlock, the pin is stored locally (outside the server’s control).

---

## 4. Commit protocol (every write)

1. Client reads `active_revision = N` and the snapshot.
2. Client verifies and checks freshness (§3, §3.1).
3. Client produces snapshot `N+1` (new nonces, same AAD rules) **including a sealed manifest for `N+1`**.
4. Server writes snapshot `N+1` **in full** (envelopes + entries + manifest). It is not active yet.
5. Server CAS: `if active_revision == N then active_revision = N+1`.
6. On CAS failure the client re-fetches and retries.

If the process dies between steps 4 and 5, `active_revision` is still `N`.  
The incomplete `N+1` object is never served. It may be garbage-collected.

**Never** flip `active_revision` before every entry, every envelope and the manifest of `N+1` is durable.

### 4.1 Backend protocol requirements (normative)

The client can *detect* an inconsistent snapshot; only the backend can *prevent*
one. These are requirements on the storage layer, not on the crypto core:

| # | Requirement |
|---|---|
| B1 | A snapshot is **immutable** once written. Never patch entries or envelopes of an existing revision in place. |
| B2 | A snapshot is published **atomically**: the single visible mutation is the `active_revision` pointer, moved by compare-and-swap from `N` to `N+1`. |
| B3 | `active_revision` moves only after every entry, every envelope **and** the manifest of `N+1` are durable. |
| B4 | Reads are served **from one revision only**. There is no endpoint that assembles “current envelopes” with “current entries” from different revisions. |
| B5 | Exactly one snapshot may exist per `(vault_id, revision)`. A second write to an existing revision is rejected, not merged — otherwise the server can equivocate. |
| B6 | `revision` increases by exactly 1 per committed write and never decreases; `vault_key_version` never decreases. |
| B7 | Concurrent writers are serialized by the CAS. A losing writer re-fetches, re-verifies and rebuilds; it must not retry with a stale manifest. |
| B8 | Partial uploads of `N+1` are garbage, never served, and may be collected. |
| B9 | Revoked device envelopes are absent from later snapshots; they are not tombstoned in a way that lets them be served again. |

What must **never** be possible:

```
revision 42
   ├── entries      ← revision 42
   ├── envelopes    ← revision 41      ✗ B4
   └── manifest     ← revision 42      ✗ detected by the client as a digest mismatch
```

B5 is the one that is easy to miss: without it a server can serve two different but
individually valid snapshots for revision 42 to two devices. The client-side
detection for that case is the pinned manifest digest (§3), which turns the second
answer into a `mismatch` instead of a silent fork.

---

## 5. Hard rotation (Vault Key change)

Required when a device may already know `VK_v`.

1. Unlock under `VK_v` at revision `N`.
2. Generate `VK_{v+1}`.
3. Re-encrypt **all** entries under `VK_{v+1}` (fresh nonces, `vaultKeyVersion = v+1`).
4. Create a full new envelope set wrapping `VK_{v+1}` (master, recovery, remaining trusted devices), each with `vaultKeyVersion = v+1`.
5. Build and seal the manifest for `N+1` under `VK_{v+1}`.
6. Commit snapshot `N+1` with `vault_key_version = v+1` using §4.
7. Drop revoked device envelopes — they are simply absent from `N+1`, and re-attaching them later fails the manifest digest set.

After commit:

- A client still holding `VK_v` cannot decrypt `N+1`.
- A server that later serves snapshot `N` is rejected by the freshness check.

Soft revocation (device not believed compromised) is still “delete that device envelope and commit a new revision with the **same** `vault_key_version`”.

**PWA:** Soft revoke is `revokeDevice` (metadata DELETE, then omit envelope, same
VK). Hard revoke is `hardRevokeDevice` (VK+1, re-encrypt, omit target, sealed
manifest, CAS, then metadata DELETE). The server rejects re-attached revoked
device envelopes and requires `sealedManifest` once `current_revision >= 1`.
Device unlock on other browsers is re-enrolled with the master password after
rotation; this client does not run a WebAuthn ceremony inside hard revoke.

---

Device-Key rotation is independent of this: a device that re-enrols generates a new
Device Key, increments its `device_key_version`, and publishes a Device Envelope
carrying that number. It does **not** change `vault_key_version`.

---

## 6. Client integrity pass after unwrap

After a snapshot is accepted as fresh and a wrapping key unwraps:

1. The sealed manifest must open under that VK for the claimed `(vault_id, revision, vault_key_version)`.
2. The snapshot must contain exactly the entries and envelopes the manifest declares (`assertSnapshotMatchesManifest`).
3. Every envelope in the snapshot must unwrap to the **same** 32-byte VK (or be ignored as not applicable to this device).
4. Every entry must decrypt under that VK. A single `AuthFailureError` fails the whole snapshot (`IntegrityError`).
5. Mixed `VK_v` entries with `VK_{v+1}` envelopes therefore cannot be applied — the manifest cannot even describe them.

Steps 3 and 4 are implemented as `verifySnapshot` / `unlockSnapshot`
(`packages/crypto/src/snapshot.ts`); steps 1 and 2 as `verifySnapshotManifest`
(`manifest.ts`). Keep both: the manifest authenticates *which* records belong to the
revision, the pass proves they all decrypt under one key, and only the pass works for
a snapshot published before the manifest existed. See `crypto-protocol.md` §8.3 for
the comparison.

---

## 6.1 Backend implementation status

The FastAPI backend implements B1, B2, B4–B8:

- Immutable snapshot rows; pointer flip after envelopes, entries, and the
  optional sealed manifest are flushed.
- `SELECT … FOR UPDATE` on the vault row serializes concurrent writers.
- Unique `(vault_id, revision)` → HTTP 409, never a merge or a 500.
- `vault_key_version` is rejected if it decreases.

B3: the sealed manifest is stored opaquely when the client sends it. The
server does not open it. Legacy snapshots without a manifest are still
served; the client then falls back to `verifySnapshot` only.

B9 is **client-driven**. `DELETE /devices/{id}` does not rewrite the snapshot.
See `docs/security-boundary.md`.

---

## 7. What the server can still do

See `threat-model.md` §3. Freshness, an authenticated manifest and atomic snapshots
stop *silent* rollback, *partial* rotation and *silent forks*. They do not stop
availability attacks (withholding the latest snapshot, refusing writes), and they do
not help a brand-new client choose which history to trust on first use.
