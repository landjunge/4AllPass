# Security Boundary (implementation)

**Companion to:** `crypto-protocol.md`, `vault-revision.md`, `webauthn-prf.md`, `threat-model.md`  
**Date:** 2026-08-18

This document describes what the **current backend + client** actually enforce.
It does not claim security properties that are not implemented.

## Authentication ≠ Vault decryption ≠ Authorization

| Layer | Proves | Does **not** prove |
|---|---|---|
| **Authentication** | this request belongs to account X | that X can decrypt any vault |
| **Authorization** | account X owns vault Y / device Z | that the snapshot is authentic |
| **Crypto** | this snapshot is authentic and can be opened only by a client holding the required key material | that the caller is logged in |

The account password is independent of the Master Password. A stolen session
cannot unwrap VK, DK, DWK, or PRF output. A stolen Master Password cannot log
into the account API.

The server never receives or derives:

- Master Password, Vault Key, Device Key, Device Wrapping Key
- WebAuthn PRF output
- decrypted entries, plaintext passwords, notes, or credentials

## Sessions (Bearer retained)

Browser authentication stays **`Authorization: Bearer`** with an opaque token.

Why cookies were **not** introduced in this pass:

1. The SPA already calls the API same-origin (`/api/v1` via the Vite / nginx proxy).
2. A Bearer token is not attached automatically by the browser, so classic
   cookie CSRF does not apply. CSRF protection is therefore handled by *not*
   using a cookie credential.
3. The token is hashed (HMAC-SHA-256 with `session_secret`) before it is stored
   in Redis / memory. Logout deletes the hash. TTL is explicit.
4. Rewriting to HttpOnly cookies would require a CSRF token scheme for every
   POST/PUT/PATCH/DELETE and a dual-mode client. That is a separate change.
5. XSS on this origin is already catastrophic for an *unlocked* vault (VK lives
   in JS memory). HttpOnly cookies would still be an improvement against
   session theft while the vault is locked; they are a **remaining limitation**,
   not a claimed property.

Never log the bearer token. `/auth/me` never returns it.

Concurrent sessions are allowed: each login mints a new token; logout revokes
only that token.

## CSRF

Bearer-in-header authentication: cross-site form posts cannot inject the
`Authorization` header. SameSite is therefore not the CSRF control.

If cookie authentication is added later, every state-changing route must gain
an explicit CSRF control. SameSite alone is not sufficient for that threat model.

## WebAuthn credential registration

`POST /vaults/{vault_id}/devices/{device_id}/credentials` stores **client-asserted
metadata**. The server does **not** verify an assertion or attestation.

| Field | What it is | What it is not |
|---|---|---|
| `prfSupported` | a client claim after a local ceremony | proof that this authenticator produced a PRF output |
| `rpId` | the RP id the client says it used | a server-verified origin bind |
| `credentialId` | an identifier the client wants stored | proof of possession |

Possession is proven later, **client-side**, when a Device-Key Envelope unwraps
under a DWK derived from that PRF (`docs/webauthn-prf.md`). The server must not
describe a stored credential as “verified”.

Device metadata registration (`POST /devices`) is separate from that
cryptographic bind.

## Device-key envelope

`PUT`/`GET` …`/device-key-envelope` require vault ownership, device membership,
and credential membership. Path identity must match the envelope’s `vaultId`,
`deviceId`, and `credentialId`. The blob stays opaque (AES-256-GCM under DWK).

A revoked device cannot receive a new envelope or a new credential until it is
explicitly re-registered (bookkeeping only).

## Device revocation

```
DELETE /devices/{device_id}
```

sets `revoked_at` on the device and its credentials. That is **database
metadata**. It is **not** cryptographic erasure.

| What happens | What that means |
|---|---|
| Flag set | further credential / envelope writes for that device are rejected; a later snapshot may not include that device envelope |
| Active snapshot unchanged | a device that already holds VK still holds VK and can still decrypt the *current* revision if it has a copy |
| Next snapshot omits the device envelope | **soft revoke** (protocol §7): the device can no longer obtain VK via sync |
| Vault Key rotation + re-encrypt | **hard revoke**: **not implemented** |

Do not read `revoked_at` as “this device can no longer decrypt the vault”.

Re-`POST` of the same `deviceId` clears the flag so the owner can re-enrol.
Cryptographic access still requires a new device envelope in a later snapshot.

## Snapshot atomicity

`POST /vaults/{vault_id}/snapshots` locks the vault row (`SELECT … FOR UPDATE`),
requires `revision = current + 1`, rejects a decreasing or skipping
`vaultKeyVersion`, and flips `active_snapshot_id` only after envelopes, entries,
and the sealed manifest are written.

The unique constraint on `(vault_id, revision)` converts a lost race into a
deterministic **409** `{ detail: "revision conflict", currentRevision }`.
Exactly one of two concurrent `10 → 11` writers wins.

The server stores the sealed manifest as opaque bytes. It does not open it
(that would require VK). The client verifies it with `verifySnapshotManifest`
before pinning `revision` / `vaultKeyVersion` / `manifestDigest`.

## Remaining limitations

- Hard revocation (Vault Key rotation + re-encrypt of every entry) is specified
  and supported by `@4allpass/crypto`; the product client does not perform it yet.
  Recommended next milestone: implement that client rotation path.
- WebAuthn assertion verification is client-side only; `public_key` on the
  credential row is nullable and unused.
- Bearer token lives in `sessionStorage` (XSS-readable).
- Rate limits are IP-bucketed and coarse (register/login and write endpoints).
- Device-key envelopes are not versioned together with the snapshot revision
  (they remain a separate, owner-gated blob).
