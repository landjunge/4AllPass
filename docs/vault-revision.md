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
└── entries[]            // all EncryptedEntry values under this VK
```

The server also stores a single pointer:

```
active_revision
```

Clients **only** fetch the snapshot named by `active_revision`.

There is no “current envelopes + current entries” assembled from different revisions.

---

## 3. Client freshness check

The client pins the last accepted `(vault_id, revision, vault_key_version)`.

`evaluateRevision(lastSeen, incoming)`:

| Incoming vs last seen | Decision |
|---|---|
| no pin yet | `first_seen` — accept and pin |
| same revision **and** same `vault_key_version` | `same` |
| higher revision, same `vault_key_version` | `advance` |
| higher revision **and** higher `vault_key_version` | `rotation` |
| lower revision | **`rollback` — refuse** |
| lower `vault_key_version` | **`downgrade` — refuse** |
| same revision, different `vault_key_version` | **`mismatch` — refuse** |
| different `vault_id` | **`mismatch` — refuse** |

Implemented in `@4allpass/crypto` as `evaluateRevision` / `assertFreshSnapshot`.  
A refused snapshot must not be decrypted into the unlocked vault.

Pin-on-first-use is intentional: a brand-new client has no prior revision. After the first successful unlock, the pin is stored locally (outside the server’s control).

---

## 4. Commit protocol (every write)

1. Client reads `active_revision = N` and the snapshot.
2. Client checks freshness (§3).
3. Client produces snapshot `N+1` (new nonces, same AAD rules).
4. Server writes snapshot `N+1` **in full** (envelopes + entries). It is not active yet.
5. Server CAS: `if active_revision == N then active_revision = N+1`.
6. On CAS failure the client re-fetches and retries.

If the process dies between steps 4 and 5, `active_revision` is still `N`.  
The incomplete `N+1` object is never served. It may be garbage-collected.

**Never** flip `active_revision` before every entry and every envelope of `N+1` is durable.

---

## 5. Hard rotation (Vault Key change)

Required when a device may already know `VK_v`.

1. Unlock under `VK_v` at revision `N`.
2. Generate `VK_{v+1}`.
3. Re-encrypt **all** entries under `VK_{v+1}` (fresh nonces).
4. Create a full new envelope set wrapping `VK_{v+1}` (master, recovery, remaining trusted devices).
5. Commit snapshot `N+1` with `vault_key_version = v+1` using §4.
6. Drop revoked device envelopes — they are simply absent from `N+1`.

After commit:

- A client still holding `VK_v` cannot decrypt `N+1`.
- A server that later serves snapshot `N` is rejected by the freshness check.

Soft revocation (device not believed compromised) is still “delete that device envelope and commit a new revision with the **same** `vault_key_version`”.

---

## 6. Client integrity pass after unwrap

After a snapshot is accepted as fresh and a wrapping key unwraps:

1. Every envelope in the snapshot must unwrap to the **same** 32-byte VK (or be ignored as not applicable to this device).
2. Every entry must decrypt under that VK. A single `AuthFailureError` fails the whole snapshot (`IntegrityError`).
3. Mixed `VK_v` entries with `VK_{v+1}` envelopes therefore cannot be applied.

---

## 7. What the server can still do

See `threat-model.md` §2.7. Freshness and atomic snapshots stop *silent* rollback and *partial* rotation. They do not stop availability attacks (withholding the latest snapshot, refusing writes).

---

## 8. Known gap: revision is not yet cryptographically bound (planned for v2)

`(revision, vault_key_version)` is plain snapshot metadata. `evaluateRevision` enforces monotonicity against the local pin, and the §6 integrity pass rejects mixed-VK snapshots, but nothing cryptographically binds the *number* `revision = N` to the ciphertexts inside snapshot `N`. A malicious server could label an authentic old entry set with a fresh revision number, as long as it never goes below the client's pin and keeps `vault_key_version` consistent.

v1 accepts this residual risk (the §6 pass plus per-entry AAD already prevents mixing across vaults, entries, and key versions that fail decryption). The planned v2 fix is an **authenticated vault manifest**: a per-snapshot structure containing `vault_id`, `revision`, `vault_key_version`, `crypto_protocol_version`, and a commitment (hash list or Merkle root) over all entry and envelope ciphertexts, sealed under the Vault Key with its own AAD label. Binding the revision into every entry AAD instead was considered and rejected for v1: it would force re-encrypting every entry on every commit and would break the pinned v1 test vectors.
