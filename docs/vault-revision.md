# 4AllPass Vault Revision & Atomic Rotation (v1)

**Status:** Authoritative for sync and hard revocation  
**Companion to:** `crypto-protocol.md` §7, `threat-model.md`  
**Date:** 2026-08-17

AES-256-GCM tells the client that a snapshot was not *modified*.  
It does **not** tell the client that a snapshot is the *latest*.

**Pin-on-first-use is intentional.** A brand-new client with no local pin accepts
the first authentic snapshot it is offered (`evaluateRevision` action
`first_seen`). It cannot tell a honest history from an attacker-constructed
valid history. After that pin, lower revision / VK / protocol, missing
manifest, or same-revision equivocation is `RollbackError` / `IntegrityError`.
Do not try to encrypt this away.

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
| higher revision, same `vault_key_version`, incoming has a manifest digest | `advance` |
| higher revision **and** higher `vault_key_version`, incoming has a manifest digest | `rotation` |
| digest pin, incoming has **no** manifest digest (same or higher revision) | **`mismatch` — refuse** |
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
4. verify/decrypt verified.entries and applicable envelopes, not the fetched objects
5. decode every plaintext entry and finish sorting the accepted entries
6. evaluateRevision(current local pin, revisionFromManifest(verified))
7. on accept: store that prepared pin locally, then return the opened vault
```

Step 4 is not cosmetic. Verification commits to the bytes it read; if the client then
applies its own copy of the snapshot, anything that can make a second read return
something else (an accessor, a lazily-decoding wrapper) puts a stale record back into
the vault after the check passed. `revisionFromManifest` likewise takes the whole
verification result, so the pinned digest can only ever be the digest of the blob that
was authenticated.

The PWA prepares that exact verified revision and digest before the content pass,
but does not save them until every entry has decrypted, decoded and sorted.
A failed AEAD pass, invalid plaintext JSON or sorting failure leaves the previous
pin intact, so retrying the previous honest snapshot is still possible. A valid
higher snapshot still advances the pin; a later genuine rollback is refused.
The final freshness check rereads the local pin before saving. This is not an
atomic compare-and-set across browser tabs.

The manifestless legacy path uses the same late pin commit, but its revision
numbers remain server-asserted. This timing repair does not authenticate legacy
metadata. Once a verified digest was pinned, a later manifestless snapshot remains
an integrity failure, even when its claimed revision is higher.

`revision` and `vault_key_version` are bounded to the uint32 range they are encoded
in. Without that bound, a single hostile answer to a fresh client (`revision =
2^53 - 1`) would poison the pin permanently: every honest snapshot afterwards would
look like a rollback. `cryptoProtocolVersion` is bounded by what the client
implements, and a pin written by a *newer* client makes an older client refuse to
proceed instead of silently downgrading.

Pin-on-first-use is intentional: a brand-new client has no prior revision. After the first successful unlock, the pin is stored locally (outside the server’s control).

### 3.1.1 Legacy manifest migration (explicit opt-in)

A manifestless snapshot is only server-asserted. The PWA offers a per-vault
migration in the unlock flow; it never commits automatically at unlock or install.
The user sees (DE/EN):

> Dieser Tresor ist älter und noch nicht als Ganzes versiegelt. Beim Aktualisieren
> wird der aktuell geöffnete Inhalt für die Zukunft mit einer Integritätsprüfung
> versehen. Der bisherige Serverstand lässt sich nicht nachträglich beweisen. Eine
> verschlüsselte Sicherung wird vorher lokal abgelegt.

> This vault is older and not yet sealed as a whole. Updating seals the currently
> opened content with an integrity check for the future. The previous server state
> cannot be proven retroactively. An encrypted backup is stored locally first.

Before the first POST the client stores and verifies the ciphertext wire backup
locally; if that fails, nothing is sent. The re-commit uses the existing
`sealManifest` / `commitSnapshot` path at `N+1` under the same Vault Key with CAS,
echo verification and the lock epoch. It attests the set that was opened at
migration time; it never authenticates the legacy revision/set as original.

On `409` the client loads and verifies the winning head; it does not overlay its
own unsaved state. On an unknown outcome a read cannot prove non-acceptance
(inflight/stale read): only the exact expected revision plus the prepared
sealed-manifest digest, or a verified history receipt, counts as success. A head
that still looks manifestless is not evidence either way; the client reports
unknown and does not send another POST just because the head is legacy.

The authenticated migration status is the sealed manifest at `N+1` verified under
the Vault Key plus the client-pinned manifest digest. A server flag or coverage
count is advisory, never cryptographic proof. The first-use manifest requirement
is **not** activated by this path; coverage/exception gates remain open. F-25
(nonce budget / persistent seal counter) is a separate open item and is not
addressed by a client-local counter.

The legacy backup lives in its own local slot, separate from the live-head cache.
It stores the **exact accepted raw wire** (unknown snapshot/entry/envelope fields
included), not a typed re-encoding. The client writes it, reads it back through
the same IndexedDB slot, and compares a key-order-insensitive canonical JSON
image before any POST. A successful migration replaces the head cache with `N+1`
but leaves the legacy wire backup intact, so it remains available after the
commit and after a restart. If the current commit schema cannot carry an unknown
field forward, the client keeps the backup and fails closed before the POST with a
clear DE/EN message instead of silently dropping it.

The migration slot is reserved atomically per `vaultId`/`vaultKeyVersion`/
`baseRevision` in IndexedDB (one read-check-write transaction; owner
`operationID` checked on every update). This reservation is claimed **before** the
backup await, so two independent tabs/modules cannot both pass an empty read,
overwrite each other's prepared receipt or both POST. There is no localStorage
fallback: if the reservation store cannot be used, nothing is sent. After an
unknown outcome, a reload, unlock or component change remains retry-blocked; only
a verified prepared manifest at the exact expected revision/digest (or a verified
history receipt) resolves it. A head that still looks legacy is not evidence
either way.

The accepted legacy state is captured defensively at open time, including the
exact raw wire and the protocol `entryDigest`/`envelopeDigest` fingerprints plus a
canonical plaintext string. The **head cache also stores that exact raw wire** for
a legacy snapshot; a legacy snapshot without its raw wire is not accepted, so an
offline reopen cannot silently migrate a re-encoded (lossy) state. The commit
works on an immutable copy; after the backup await the live
entries/envelopes/revision are re-checked immediately before encryption. Same
entry ids with changed payloads, changed envelope bytes, changed metadata or a
mutation during the backup await stop the migration before any POST. The pin is
saved only after the cache await and the liveness check; a newer pin (another tab)
or a late lock discards and zeroizes the opened key and never returns it. The existing commit contract
re-encrypts entries with fresh nonces; the lossless guarantee covers the complete
plaintext entry set and the byte-identical envelopes, and the new manifest
authenticates the new ciphertext. No new algorithm or vault format is introduced.
Async lock boundaries are checked before `acceptSnapshot` and after its cache
await; a late lock discards the opened key, leaves the pin unchanged and does not
hand an accepted vault to the UI.

### 3.2 Offline: last verified snapshot

After a snapshot is verified and the pin is written, the PWA stores the **wire**
snapshot (ciphertext, envelopes, sealed manifest) in IndexedDB keyed by
`vaultId`. It does not store the Vault Key or plaintext entries.

On unlock, `GET /snapshot` is tried first. If the request fails before an HTTP
status (`TypeError` / no network), the cached snapshot is used instead. HTTP
4xx/5xx do not fall back — those are server answers, not “offline”.

The pin still runs (`assertFreshSnapshot`) on the cached bytes. A cache older
than the pin is a rollback and is refused. A successful unlock rewrites the
cache from the snapshot that just verified.

XSS on this origin can read the cache the same way it can read a live GET. The
cache is not a second security boundary.

---

## 4. Commit protocol (every write)

1. Client reads `active_revision = N` and the snapshot.
2. Client verifies and checks freshness (§3, §3.1).
3. Client produces snapshot `N+1` (new nonces, same AAD rules) **including a sealed manifest for `N+1`**.
4. Server writes snapshot `N+1` **in full** (envelopes + entries + manifest). It is not active yet.
5. Server CAS: `if active_revision == N then active_revision = N+1`.
6. On CAS failure the client **must not last-write-wins**. v1: surface the
   conflict (`CommitConflict` / HTTP 409), load the winning snapshot, and let
   the user continue. Do not auto-replay the loser’s in-memory entries onto
   the winner (that drops the other device’s edits). Do not merge fields.
   Entry-level merge is later. Placement rules: [`vault-storage.md`](vault-storage.md).

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
| B7 | Concurrent writers are serialized by the CAS. A losing writer re-fetches and re-verifies the **winning** snapshot. It must not retry with a stale manifest and must not silently overlay its unsaved plaintext onto that winner (v1: reload; no auto-merge). |
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
manifest, verified CAS receipt/caller adoption, then metadata DELETE). The
server rejects re-attached revoked device envelopes and requires `sealedManifest` once `current_revision >= 1`.
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
- A same-VK commit and a hard-revoke (VK++) aimed at the same `expectedRevision`
  are the same CAS race: one 200, one 409. Measured:
  `backend/tests/security/test_snapshots.py::test_concurrent_same_vk_commit_and_hard_revoke_one_wins`.
- Mirror PUT uses the same `expectedRevision` pointer. A stale PUT racing
  `N→N+1` is 200 or 409, never a merge
  (`test_concurrent_snapshot_commit_and_stale_mirror_put`).
  See `docs/security-boundary.md` §5.

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

## P04 library candidate and freshness boundary

The [explicit snapshot/manifest v2 library candidate](crypto/snapshot-manifest-v2-candidate.md)
authenticates a version-bound manifest and its complete child set when a caller
explicitly opts in. Revision evaluation and pin persistence now also accept an
explicit v2 expectation, preserving protocol and digest. Defaults remain v1; a
pinned vault cannot change protocol, and malformed stored pins are errors rather
than first use. Session call-site integration is still open. These primitives do
not establish migrating a v1 vault or completing bootstrap/signed commit/readback.


### Recovery after a confirmed reset and local pin-save failure

The recovery coordinator distinguishes a failed reset from a confirmed reset
whose local adoption is pending. It retains the verified result privately and
refuses another reset from the consumed source object. `retryAdoption()` accepts
no password or recovery text; it retries only local pin persistence and adoption.
The existing DE/EN recovery dialog hides password/kit inputs and device actions
while this local step remains pending.

The original account, exact vault object, generation and lock epoch remain bound
through reset and adoption. Validity is checked again after storage callbacks;
clear, context changes and unmount discard unadopted key material. Explicit close
and pending unmount use the existing lifecycle lock for the unchanged source
context, preserving lock-epoch and clipboard cleanup. A newer foreign context
is never locked by a stale completion.

Captured liveness reaches recovery preparation and the existing commit gates
before mutation, before send and after response. Locking after an actual send
does not cancel or roll back the possible server commit. It prevents local
adoption and automatic retry; transport outcomes remain distinct from a
confirmed commit followed by a local storage error. No protocol migration or
V2 activation is introduced. These development checks do not change historical
releases or establish installed-app acceptance.
