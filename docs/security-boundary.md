# Security boundary (implementation)

**Companion to:** `crypto-protocol.md`, `vault-revision.md`, `webauthn-prf.md`, `threat-model.md`  
**Date:** 2026-08-18

This document describes what the **running backend + PWA** actually enforce.
It does not restate the crypto protocol. If a sentence here disagrees with
`packages/crypto`, the library and its tests win.

---

## 1. Three different proofs

| Proof | Question it answers | Mechanism |
|---|---|---|
| **Authentication** | “This is account X.” | Email + account password → revocable Bearer session |
| **Authorization** | “Account X owns vault Y / device Z.” | Server-side `get_owned_vault`; foreign ids are 404 |
| **Crypto** | “This snapshot is authentic and only an authorized client can decrypt it.” | Client-side AES-GCM, envelopes, sealed manifest |

Authentication is **not** vault decryption. The account password cannot unwrap
a Vault Key. A valid session token only authorizes *storage* operations.

The server must never receive or derive: Master Password, Vault Key (VK),
Device Key (DK), Device Wrapping Key (DWK), WebAuthn PRF output, or plaintext
entries / notes / credentials. Request schemas do not accept those fields.

---

## 2. Sessions (Bearer is retained)

The browser sends `Authorization: Bearer <token>` and `X-Device-Id`. The token
is a `secrets.token_urlsafe(32)` value. Redis (or the in-memory test store)
keeps only `HMAC-SHA256(session_secret, token)` → `{user_id, email, device_id}`
with a TTL (default 14 days). Logout deletes that key. Tokens are never logged.

Login and register refuse to mint a session without a well-formed `X-Device-Id`.
`get_current_user` rejects a valid token presented with a different device id.
`X-Device-Id` is **client-asserted** — it is not a WebAuthn proof. A thief who
has both the token and the id can still use the session. A thief who has only
the token cannot.

`DELETE /devices/{id}` revokes every session bound to that device id except the
calling token, so a hard rotate on this device can still commit snapshot `N+1`.

Concurrent logins create independent tokens, each bound to the device id sent
at mint time. Logging out one does not revoke the others. There is no session
fixation: login always mints a new token.

**Why not HttpOnly cookies?**

- The PWA already talks to a same-origin `/api/v1` via a Bearer header.
- A custom `Authorization` header is not sent by a cross-site form POST, so
  classic cookie CSRF does not apply to this design.
- Sessions are already server-revocable (logout / TTL / `is_active`).
- Moving to cookies would require a CSRF token (or equivalent) and a rewrite
  of the client store. That is a later milestone, not a hardening of the
  current boundary.

`sessionStorage` still means XSS can read the account token. That is accepted
in `threat-model.md` (malicious client). The token still cannot decrypt the
vault.

**CSRF:** Bearer authentication is not cookie-authenticated, so CSRF
protection is “the browser will not attach `Authorization` to a foreign form
POST.” SameSite is therefore not the CSRF control here. If cookies are
introduced later, CSRF tokens become mandatory; SameSite alone is not enough.

Production refuses to start if `FOURALLPASS_SESSION_SECRET` is still the
insecure default.

---

## 3. WebAuthn trust boundary

`POST /vaults/{vault_id}/devices` and `POST …/credentials` store **client-asserted
metadata**. The server does **not**:

- run a WebAuthn ceremony
- verify an attestation or assertion signature
- see or check PRF output
- treat `prfSupported: true` as proof of possession

`CredentialSummary.verification` is always `"client_asserted"` and
`serverVerified` is always `false`. Those fields exist so the API cannot be
read as “the server verified this passkey.”

Vault unlock still requires the real authenticator on the client
(`packages/webauthn` + `docs/webauthn-prf.md`). A fabricated
`prf_supported` flag cannot produce a DWK.

---

## 4. Device revocation (do not over-claim)

`DELETE /vaults/{vault_id}/devices/{device_id}` sets `revoked_at` on the device
and its credentials. The response says `revocation: "metadata_only"`.

That is **not** cryptographic erase.

| What DELETE does | What DELETE does not do |
|---|---|
| Sets `revoked_at` | Remove the device envelope from the active snapshot by itself |
| Blocks GET/PUT of the Device-Key Envelope mirror | Increment `vault_key_version` |
| Blocks new credential metadata on that row | Invalidate an already-unwrapped VK cached in a browser |
| Leaves `hasDeviceEnvelope` reflecting the snapshot until the client commits | Bind the account session to a WebAuthn credential |
| Revokes other sessions bound to that device id | Kill the calling session (so rotate can still commit) |

The PWA implements both layers:

| Path | Client | Crypto effect |
|---|---|---|
| **Soft** `revokeDevice` | Metadata DELETE, then commit revision N+1 **without** that device envelope, **same** `vaultKeyVersion` | Device can no longer unwrap via sync; a client that already holds VK still can |
| **Hard** `hardRevokeDevice` | Verify master (+ recovery if present) → VK+1 → re-encrypt entries → rebuild master/recovery (device envelopes only if DK is locally recoverable without WebAuthn) → omit target → sealed manifest → **CAS commit**, then metadata DELETE | Snapshot N+1 is sealed under VK₂; holders of VK₁ cannot decrypt it |

Foreign Device Keys are never available to the acting client. This device’s DK is
only rewrapped when it is already recoverable from local material (no new
WebAuthn `get` inside hard revoke). Otherwise the rotated snapshot has no
device envelopes and every device — including this one — re-enrols with the
master password via `enableDeviceUnlockForVault`.

Sessions for the revoked device id are dropped except the caller’s token.
`X-Device-Id` is client-asserted and is **not** a substitute for Vault Key
rotation. A stolen token plus stolen device id can still use the account
session; it cannot decrypt a snapshot sealed under VK₂.

Re-POSTing the same `deviceId` clears `revoked_at`. That is metadata
re-enrolment only. It does not put an envelope back. The server also rejects
commits that re-attach a revoked device’s envelope (HTTP 422).

---

## 5. Snapshot atomicity

`POST /vaults/{vault_id}/snapshots`:

1. `SELECT … FOR UPDATE` on the vault row (writers serialize).
2. Compare `expectedRevision` / `revision` against the active snapshot.
3. Reject `vaultKeyVersion` decreases.
4. When `current_revision >= 1`, require `sealedManifest` (stored opaque; not decrypted).
5. Reject any `type == device` envelope whose `device_id` has `revoked_at` set.
6. Insert a new immutable snapshot row (envelopes + entries + sealed
   manifest), then flip `active_snapshot_id`.
7. A unique `(vault_id, revision)` constraint is the last line of defence.
   A colliding write becomes HTTP 409 `revision conflict`, not 500.

Two clients both at revision 10 → 11: exactly one wins; the loser gets 409
with `currentRevision`.

The server does not open the sealed manifest. It stores the client-supplied
object and returns it unchanged. The client verifies it under VK
(`verifySnapshotManifest`) before pinning `revisionFromManifest`.

---

## 6. Remaining limitations (honest)

- No server-side WebAuthn assertion verification.
- Hard revoke does not rewrap foreign device envelopes (or this device’s when
  the DK needs a WebAuthn ceremony); those devices re-enrol after master unlock.
- Account session is bound to a client-asserted `X-Device-Id`, not to a
  WebAuthn credential. Stolen token + stolen device id still works.
- Device-Key Envelope mirror is a separate GET/PUT, not CAS-tied to
  `active_revision` (a stale DK generation can still be served until the
  client refuses it).
- Bearer token lives in `sessionStorage` (XSS = account takeover, not vault
  plaintext by itself).
- Rate limits are per-IP counters, not a full abuse platform.
- Soft `DELETE` remains `metadata_only` — it is not cryptographic erase.

Hard Vault Key rotation in the PWA is implemented (`hardRevokeDevice`). Next:
CAS-tie the Device-Key Envelope mirror to `active_revision`, wire a hard-revoke
control in the devices UI, and optionally add server-side WebAuthn assertion
verification as ceremony integrity — not as a replacement for client-side PRF.
