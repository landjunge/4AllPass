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
└── sealed_manifest      // AEAD under HKDF(VK); authenticates every field above
```

`revision` / `vault_key_version` in the snapshot header or a SQL column are **untrusted**.  
The client takes those numbers from the **opened manifest**, then runs `evaluateRevision`.  
`acceptSnapshot` is the required entry point.

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
Those functions are **policy only**. They do not prove that the numbers belong to the ciphertext.

The client **must** obtain the incoming `VaultRevision` from `openManifest` / `acceptSnapshot`, not from a server column.  
A refused snapshot must not be decrypted into the unlocked vault.

Pin-on-first-use is intentional: a brand-new client has no prior revision. After the first successful unlock, the pin is stored locally (outside the server’s control).

---

## 4. Commit protocol (every write)

1. Client reads `active_revision = N` and the snapshot.
2. Client checks freshness (§3).
3. Client produces snapshot `N+1` (changed entries get new nonces; unchanged ciphertexts may be reused).
4. Client seals a **Vault Manifest** over the exact envelope + entry set of `N+1`.
5. Server writes snapshot `N+1` **in full** (envelopes + entries + sealed manifest). It is not active yet.
6. Server CAS: `if active_revision == N then active_revision = N+1`.
7. On CAS failure the client re-fetches and retries.

If the process dies between steps 5 and 6, `active_revision` is still `N`.  
The incomplete `N+1` object is never served. It may be garbage-collected.

**Never** flip `active_revision` before every entry, every envelope, **and** the sealed manifest of `N+1` are durable.

**Never** publish revision `N+1` while any served entry or envelope still belongs to revision `N`. The snapshot is one object.

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

1. `acceptSnapshot` has already bound the claimed revision to the ciphertext set.
2. Every envelope in the snapshot must unwrap to the **same** 32-byte VK (or be ignored as not applicable to this device).
3. Every entry must decrypt under that VK. A single `AuthFailureError` fails the whole snapshot (`IntegrityError`).
4. Mixed `VK_v` entries with `VK_{v+1}` envelopes therefore cannot be applied.
5. Mixed revision-`N` entries with a revision-`N+1` header fail the manifest commitment check even when they still decrypt under the same VK.

---

## 7. What the server can still do

See `threat-model.md` §2.7. Freshness and atomic snapshots stop *silent* rollback and *partial* rotation. They do not stop availability attacks (withholding the latest snapshot, refusing writes).
