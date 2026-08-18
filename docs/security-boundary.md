# Security Boundary (implementation)

**Status:** Describes the backend and browser client as implemented.
**Does not replace:** `crypto-protocol.md`, `webauthn-prf.md`, `vault-revision.md`, `threat-model.md`.

Authentication, authorization, and cryptography are three different proofs.
Do not treat one as if it were another.

```
Authentication
    ↓
Authenticated User
    ↓
Vault Ownership
    ↓
Device Authorization (metadata + envelope presence)
    ↓
Encrypted Snapshot
    ↓
Client-side Crypto
```

## What each layer proves

| Layer | Proves | Does not prove |
|---|---|---|
| **Authentication** | this request is user X | user X can decrypt anything |
| **Authorization** | user X owns vault Y / device Z | the vault is authentic or decryptable |
| **Crypto** | this encrypted vault state is authentic and can only be opened by a client that holds the required key material | the caller is logged in |

Account login and the Master Password are independent
(`crypto-protocol.md` Hard Invariant #5). The server never receives or derives:

- Master Password
- Vault Key (VK)
- Device Key (DK)
- Device Wrapping Key (DWK)
- WebAuthn PRF output
- decrypted vault entries, passwords, notes, or credentials

## Sessions and CSRF

The browser application uses cookie authentication, not a JavaScript-readable
Bearer token.

- Session cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production, explicit
  `Max-Age`, path `/api/v1`.
- CSRF cookie: readable by the page, echoed as `X-CSRF-Token` on
  `POST` / `PUT` / `PATCH` / `DELETE`.
- Logout deletes the server-side session and clears both cookies.
- SameSite alone is not the CSRF control. Cross-site attackers who can still
  cause credentialed requests (older browsers, some embedded webviews) are
  stopped by the header/cookie equality check against the stored session CSRF
  secret.

`Authorization: Bearer` remains valid for non-browser clients. Those requests
do not automatically attach cookies, so they are not a CSRF channel. The
browser client does not store or send Bearer tokens.

Session tokens are never returned in JSON and are never logged. Redis stores
only an HMAC of the token.

## Device registration vs WebAuthn proof

`POST /vaults/{vault_id}/devices` stores **device metadata**.

`POST /vaults/{vault_id}/devices/{device_id}/credentials` stores **client-attested
ceremony metadata** (`credentialId`, `rpId`, `prfSupported`, …).

`prfSupported = true` is a client claim. The server does **not** run a WebAuthn
assertion or verify an authenticator signature. `serverVerified` is `true` only
when a COSE public key has been stored for later assertion verification; that
path is not implemented yet.

What the protocol *does* prove, on the client:

- PRF output → DWK → Device-Key Envelope → DK → Device Envelope → VK
- Envelope AAD binds `vaultId`, `deviceId`, `credentialId`, versions
- A forged or substituted Device-Key Envelope fails unwrap

The server must not claim a credential is verified merely because the client
said so.

## Device-Key Envelope mirror

`PUT`/`GET …/device-key-envelope` store and return an opaque blob. Access
requires vault ownership, device membership, and credential membership.
Cross-device, cross-vault, and cross-credential substitution is rejected.
Revoked devices and credentials cannot read or replace the mirror.

The blob stays compatible with `docs/webauthn-prf.md` §4. The server cannot
open it.

## Revocation

`DELETE /devices/{device_id}` is **bookkeeping plus an access boundary**.
It is not cryptographic erasure.

Implemented now:

1. `revoked_at` is set on the device and its credentials.
2. The same `device_id` cannot be reactivated.
3. Device-Key Envelope GET/PUT for that device returns `410`.
4. Later snapshots that still include that device's VK envelope are rejected.
5. The honest client drops the device envelope in the next revision.

Not implemented, and therefore **not claimed**:

- Vault Key rotation (`vaultKeyVersion` + 1)
- Re-encryption of entries under a new VK
- New envelopes for remaining devices after a suspected compromise

A device that already knows `VK_v` can still decrypt any later snapshot that
stays on `vaultKeyVersion = v`. Soft revoke only stops that device from
receiving a *new* device envelope and from using the convenience-unlock
mirror. Hard revocation remains a future client milestone; see
`vault-revision.md` §5.

## Snapshots

The server stores one immutable snapshot per `(vault_id, revision)`, including
the sealed manifest as opaque bytes. Publication is:

1. lock the vault row
2. compare `expectedRevision` / `revision` against the active snapshot
3. write manifest + envelopes + entries
4. flip `active_snapshot_id`

A concurrent `10 → 11` / `10 → 11` pair yields exactly one `200` and one
deterministic `409 { detail: "revision conflict", currentRevision }`.
The unique constraint on `(vault_id, revision)` is the second line of defense.

The server does not reorder, normalize, or decrypt authenticated bytes. The
client seals and verifies the manifest (`crypto-protocol.md` §8.1).

## Remaining limitations

- No server-side WebAuthn assertion verification
- No Vault Key rotation on revoke
- First-use snapshot choice is still pin-on-first-use (`threat-model.md` §3)
- Rate limits are per-IP buckets for auth and state-changing writes, not a
  full abuse platform
