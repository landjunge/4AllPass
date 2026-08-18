# 4AllPass Security Boundary (v1)

**Companion to:** `crypto-protocol.md`, `webauthn-prf.md`, `vault-revision.md`, `threat-model.md`  
**Date:** 2026-08-18  
**Status:** Matches the current implementation. Do not read a function name as a security property.

This document is the server-side counterpart of the crypto protocol. The crypto
core proves authenticity and confidentiality of vault state. The backend proves
**who is allowed to store and fetch that opaque state**. The two are not the same.

```
Authentication
    ↓
Authenticated User
    ↓
Vault Ownership
    ↓
Device Authorization (metadata + snapshot envelopes)
    ↓
Encrypted Snapshot
    ↓
Client-side Crypto
```

---

## 1. Three distinct proofs

| Proof | Question it answers | Mechanism |
|---|---|---|
| **Authentication** | "this is user X" | Account email + Argon2id account password + revocable Bearer session |
| **Authorization** | "user X owns vault Y" | `get_owned_vault` — missing and foreign vaults are both 404 |
| **Crypto** | "this encrypted vault state is authentic and can only be decrypted by a client holding the required key material" | AES-256-GCM, AAD, sealed manifest, `evaluateRevision` |

Authentication never grants vault decryption. An account-password compromise
does not yield VK, DK, DWK, PRF output, or plaintext entries.

---

## 2. What the server must never receive or derive

The API stores only opaque ciphertext and account metadata. It must never see:

- Master Password
- Vault Key (VK)
- Device Key (DK)
- Device Wrapping Key (DWK)
- WebAuthn PRF output
- decrypted vault entries
- plaintext passwords, notes, or credentials

Account passwords are hashed with Argon2id and never returned. Session tokens
are HMAC-hashed before they touch Redis. Responses use explicit Pydantic
schemas; ORM models are not returned.

---

## 3. Sessions — why Bearer is retained

The browser client is a same-origin SPA talking to `/api/v1`. Authentication
uses an opaque Bearer token:

- issued on register/login
- stored in memory + `sessionStorage` (account session, not vault unlock)
- looked up server-side after HMAC
- revoked on logout
- expired by TTL (`FOURALLPASS_SESSION_TTL_SECONDS`, default 14 days)
- concurrent sessions are independent

**Why not HttpOnly cookies in this pass:**

1. The `Authorization` header is not attached automatically by the browser, so
   classical cross-site cookie CSRF does not apply. SameSite is therefore not
   the CSRF control; the missing ambient credential is.
2. Migrating to cookies without a CSRF token (or a double-submit / custom
   header requirement) would *introduce* CSRF on POST/PUT/PATCH/DELETE.
3. XSS can already read `sessionStorage` **and** an unlocked Vault Key in
   memory. An HttpOnly cookie would not contain the vault secrets and would
   not change the XSS outcome for vault confidentiality.

This is a justified retention, not a default. A later cookie migration must
ship CSRF protection for every state-changing route and must not claim that
SameSite alone is sufficient.

CSRF for the current design: a cross-site attacker cannot make the victim's
browser send the Bearer token. They can still attack via XSS in the origin.

---

## 4. Device registration is two different things

### A. Device metadata registration — `POST /vaults/{vault_id}/devices`

Stores `deviceId`, label, platform, user-agent. This is bookkeeping. It does
not prove that a WebAuthn authenticator exists.

Re-posting the same `deviceId` after a revoke does **not** silently clear
`revoked_at`. Clearing it requires `reactivate: true` from an already
authenticated owner (the client only sends that after an unlocked vault).

### B. Credential metadata registration — `POST .../credentials`

Stores `credentialId`, `rpId`, `mechanism`, `prfSupported`,
`largeBlobSupported`. These fields are **client claims**.

The server does **not**:

- run `navigator.credentials.create` / `get`
- verify an authenticator assertion
- see PRF output
- treat `prfSupported: true` as proof of PRF possession

Response fields make that explicit:

| Field | Meaning |
|---|---|
| `prfSupported` | what the client claimed |
| `webauthnPossessionVerified` | always `false` until a server-side ceremony exists |
| `prfVerifiedByServer` | always `false` until a server-side ceremony exists |

Cryptographic possession is proven **on the client** by the WebAuthn PRF
construction (`docs/webauthn-prf.md`): PRF → HKDF → DWK → Device-Key Envelope
→ DK → Device Envelope → VK. A forged `prfSupported` flag cannot produce a
Device Envelope that unwraps under a real VK, because the attacker does not
hold VK.

---

## 5. Device-Key Envelope mirror

`PUT`/`GET` `.../credentials/{credential_id}/device-key-envelope` stores an
opaque AES-256-GCM blob (DK wrapped under DWK). The server never decrypts it.

Access requires:

- a valid session
- vault ownership
- the path `deviceId` to belong to that vault
- the path credential to belong to that device
- envelope `vaultId` / `deviceId` / `credentialId` to match the path
- the device (and credential) to not be metadata-revoked

Cross-device or cross-vault substitution is 422/404. The stored bytes are
echoed from the database, not from unchecked client fields.

---

## 6. Device revocation — do not over-claim

`DELETE /vaults/{vault_id}/devices/{device_id}` is **metadata revocation**.

It does:

- set `revoked_at` on the device and its credentials
- delete the mirrored Device-Key Envelope (no further convenience-unlock fetch)
- refuse later credential / envelope writes until `reactivate: true`
- report `revocationKind: "metadata_only"`

It does **not**:

- rotate the Vault Key
- drop the Device Envelope from the already-published snapshot
- erase VK from a device that already unwrapped it
- make `hasDeviceEnvelope` become false by itself

| Kind | What actually happens | How |
|---|---|---|
| Metadata revoke | Bookkeeping + DKE mirror deleted | `DELETE /devices/{id}` |
| Soft cryptographic revoke | Device can no longer *fetch* a wrapping of the current VK | Client commits `N+1` **without** that device envelope |
| Hard cryptographic revoke | Device that already knows `VK_v` cannot read future state | Client rotates VK (`vaultKeyVersion + 1`) and re-encrypts; **not implemented as an automatic server action** |

`hasDeviceEnvelope` is the only honest signal for "does the active snapshot
still contain a Device Envelope for this device?". After `DELETE` it may
still be `true`. Tests assert that the API does not claim otherwise.

Hard rotation remains a client-side snapshot write as specified in
`vault-revision.md` §5. The server accepts a higher `vaultKeyVersion` and
refuses a decrease. It does not invent a new rotation protocol.

---

## 7. Snapshot atomicity

`POST /vaults/{vault_id}/snapshots` is the only publication path.

- The vault row is locked (`SELECT … FOR UPDATE`)
- `revision` must be exactly `current + 1`
- `expectedRevision`, if sent, must equal `current`
- `vaultKeyVersion` must not decrease
- a master envelope is required
- unique `(vault_id, revision)` is the second line of defence
- `active_snapshot_id` flips only after envelopes and entries of `N+1` are written
- concurrent writers: exactly one 200, the other 409 `revision conflict`

The server stores opaque bytes. It does not reorder, normalize, or decrypt
ciphertext. Manifest verification remains a client duty
(`verifySnapshotManifest`). A mixed snapshot that somehow reached storage
would still be rejected by the crypto core; the lock + unique constraint
exist so it should not be published.

---

## 8. Rate limiting

IP-bucket limits (default 10 / 60s, `FOURALLPASS_AUTH_LOGIN_RATE_LIMIT`) apply to:

- register, login
- device registration, credential registration, Device-Key Envelope PUT
- snapshot commits

This is abuse dampening, not a substitute for Argon2id or ownership checks.

---

## 9. Remaining limitations (honest)

1. **No server-side WebAuthn ceremony.** Credential rows are claimed metadata.
2. **No automatic hard rotation.** `DELETE` ≠ cryptographic erase.
3. **Device-Key Envelope mirror is not snapshot-CAS-gated.** The protocol
   prefers committing the mirror with `revision` (`webauthn-prf.md` §4.2).
   Today the mirror is a separate table; freshness of *vault* state still
   comes from the snapshot. A stale mirror cannot unwrap a rotated Device
   Envelope because `deviceKeyVersion` is in the AAD.
4. **Bearer token in `sessionStorage` is XSS-readable.** XSS on the origin
   is already vault-compromising while unlocked.
5. **Pin-on-first-use.** A new client has no revision pin; an active server
   chooses the first snapshot it sees (`threat-model.md` §3).
6. **Account password is not the Master Password**, but a weak account
   password still lets an attacker *store* hostile snapshots for that user.

---

## 10. Recommended next milestone

Server-side WebAuthn ceremony (challenge, attestation/assertion verify,
store COSE public key) **or** automatic hard-rotation assistance that still
lets the client seal the new snapshot — not a new feature surface.
