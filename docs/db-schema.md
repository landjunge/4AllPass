# 4AllPass Database Schema (v1)

**Status:** Authoritative for the server
**Companion to:** `crypto-protocol.md` §11, `vault-revision.md`, `webauthn-prf.md`
**Migration:** `backend/alembic/versions/0001_initial_schema.py`

Every blob column is opaque. The server cannot unwrap an envelope, decrypt an
entry, or reconstruct a Device Wrapping Key. What it *can* do is refuse
structurally impossible data, which is why the byte lengths and the
type/field rules of Crypto Protocol v1 exist here as CHECK constraints too.

---

## 1. Tables

```
accounts ───┬── account_identities            (Google / Apple, comfort only)
            └── vaults ──┬── vault_snapshots ─┬── key_envelopes
                         │                    └── encrypted_entries
                         └── devices ─────────── webauthn_credentials
                                                   └── device_key_envelopes
```

| Table | Holds | Never holds |
|---|---|---|
| `accounts` | e-mail, Argon2id hash of the **account** password | master password |
| `account_identities` | OAuth provider + subject | anything key-related |
| `vaults` | `vault_id`, `active_revision`, `active_vault_key_version` | the Vault Key |
| `vault_snapshots` | immutable revisions, `pending` / `committed` | — |
| `key_envelopes` | wrapped Vault Keys + Argon2id parameters | unwrapped keys |
| `encrypted_entries` | entry ciphertext, `schema_version` | plaintext |
| `devices` | device id, coarse label, revocation time | — |
| `webauthn_credentials` | credential id, rp id, mechanism, UV flag | public key, PRF output |
| `device_key_envelopes` | opaque PRF mirror of a Device-Key Envelope | the Device Wrapping Key |

---

## 2. Vault pointer and snapshots

`vaults.active_revision` is the single pointer clients read. A commit writes
snapshot `N+1` in full with `status = 'pending'`, then moves the pointer with

```sql
UPDATE vaults
   SET active_revision = :new, active_vault_key_version = :vkv
 WHERE id = :vault_id
   AND active_revision IS NOT DISTINCT FROM :expected;
```

`rowcount = 0` means another client committed first, and the API answers `409`
with `currentRevision`. A crash before the pointer moves leaves the snapshot
`pending`, and a pending snapshot is never served.

Constraints:

- `uq_vault_snapshots_vault_id_revision` — a revision number exists once.
- `ck_vault_snapshots_committed_at_matches_status` — `committed` implies a
  timestamp, so a half-written row cannot look servable.
- `ck_vaults_active_pointer_consistent` — revision and vault-key version are set
  together or not at all.

`vault_key_version` may stay equal (normal edit) or increase by exactly one
(hard rotation). The API enforces the step; the column enforces `>= 1`.

---

## 3. Key envelopes

```sql
octet_length(nonce)      = 12
octet_length(ciphertext) = 32     -- a wrapped 256-bit Vault Key, nothing else
octet_length(tag)        = 16
crypto_version           = 1
(type = 'device')  = (device_id IS NOT NULL)
(type = 'master')  = (kdf_algorithm IS NOT NULL)
kdf_algorithm = 'argon2id' AND kdf_version = 19 AND kdf_hash_len = 32
  AND octet_length(kdf_salt) BETWEEN 16 AND 32
```

`uq_key_envelopes_snapshot_id_type_device_id` uses `NULLS NOT DISTINCT`, so one
snapshot carries at most one master envelope, one recovery envelope, and one
envelope per device.

The API additionally refuses a master envelope whose Argon2id memory is below
32 MiB, keeping the test-only `ci` profile out of real vaults.

**Access is the envelope.** A device can obtain the Vault Key exactly when the
active snapshot contains a device envelope for its `device_id`. Soft revocation
is the absence of that row in the next revision, not a flag.

---

## 4. Encrypted entries

```sql
octet_length(nonce) = 12
octet_length(tag)   = 16
octet_length(ciphertext) >= 1
schema_version >= 1
crypto_version  = 1
```

`schema_version` is stored, never guessed, so a v2 payload stays decryptable
after a schema bump. `(snapshot_id, entry_id)` is unique.

---

## 5. Devices and WebAuthn credentials

`devices` is unique per `(vault_id, device_id)`; the `device_id` is the value
bound into the device envelope AAD and into the DWK derivation.

`webauthn_credentials` stores what the server legitimately needs for device
management: the raw credential id, the rp id, which unlock rank was provisioned
(`prf`, `large_blob`, `uv_gated_local`), and the capability flags shown in the
UI. `ck_webauthn_credentials_user_verification_required` makes
`userVerification = "required"` a schema-level fact.

There is no public key column: 4AllPass does not verify WebAuthn signatures
server-side. The assertion is a *local* trigger for key material, so a signature
check would add nothing (see `webauthn-prf.md` §6).

---

## 6. `device_key_envelopes` — the opaque PRF mirror

```
credential_pk → webauthn_credentials.id   (unique: one mirror per credential)
vault_id, device_id, crypto_version
nonce (12) · ciphertext (32) · tag (16)
```

This is the Device-Key Envelope of `webauthn-prf.md` §4: the random Device Key
wrapped under the **Device Wrapping Key**. Only a live PRF assertion on that
authenticator can produce the DWK, so a server that holds this row still cannot
reach the Device Key, and therefore cannot reach the Vault Key.

Mirroring is accepted **only** for the `prf` mechanism. Ranks 2 and 3 wrap the
Device Key under a key that lives on the client (authenticator `largeBlob` plus
local store, or local store alone), and uploading those would move the trust
boundary for no benefit.

---

## 7. What a full database dump gives an attacker

- Account e-mails and account password hashes (Argon2id).
- Vault sizes, revision history, device labels, and unlock mechanisms.
- Wrapped keys and entry ciphertext, all AES-256-GCM with mandatory AAD.
- The PRF mirror, unusable without that authenticator.

It does not give the Vault Key, any entry plaintext, the master password, or a
path to them that avoids an offline attack against Argon2id.
