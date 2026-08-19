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
| Sets `revoked_at` | Remove the device envelope from the active snapshot |
| Blocks GET/PUT of the Device-Key Envelope mirror | Increment `vault_key_version` |
| Blocks new credential metadata on that row | Invalidate an already-unwrapped VK cached in a browser |
| Leaves `hasDeviceEnvelope` reflecting the snapshot | Invalidate an already-unwrapped VK cached in a browser |
| Revokes other sessions bound to that device id | Kill the calling session (so rotate can still commit) |

The expected model remains:

```
metadata revoke
    → client commits snapshot N+1 without that device envelope   (soft)
    → if the device may already know VK: rotate vaultKeyVersion  (hard)
```

Hard rotation is implemented and tested in `packages/crypto`. The PWA does
**not** rotate keys yet (`frontend/src/lib/vault-session.ts`). A revoked
device that still holds VK can decrypt any snapshot still sealed under that
VK, including ones it downloads if it still holds a matching session. Sessions
for that device id are dropped except the caller's token. `X-Device-Id` is not
a substitute for Vault Key rotation.

Re-POSTing the same `deviceId` clears `revoked_at`. That is metadata
re-enrolment only. It does not put an envelope back.

---

## 5. Snapshot atomicity

`POST /vaults/{vault_id}/snapshots`:

1. `SELECT … FOR UPDATE` on the vault row (writers serialize).
2. Compare `expectedRevision` / `revision` against the active snapshot.
3. Reject `vaultKeyVersion` decreases.
4. Insert a new immutable snapshot row (envelopes + entries + optional sealed
   manifest), then flip `active_snapshot_id`.
5. A unique `(vault_id, revision)` constraint is the last line of defence.
   A colliding write becomes HTTP 409 `revision conflict`, not 500.

Two clients both at revision 10 → 11: exactly one wins; the loser gets 409
with `currentRevision`.

The server does not open the sealed manifest. It stores the client-supplied
object and returns it unchanged. The client verifies it under VK
(`verifySnapshotManifest`) before pinning `revisionFromManifest`.

---

## 6. Remaining limitations (honest)

- No server-side WebAuthn assertion verification.
- No PWA Vault Key rotation (hard revoke).
- Account session is bound to a client-asserted `X-Device-Id`, not to a
  WebAuthn credential. Stolen token + stolen device id still works.
- Device-Key Envelope mirror is a separate GET/PUT, not CAS-tied to
  `active_revision` (a stale DK generation can still be served until the
  client refuses it).
- Bearer token lives in `sessionStorage` (XSS = account takeover, not vault
  plaintext by itself).
- Rate limits are per-IP counters, not a full abuse platform.

Recommended next milestone: CAS-tie the Device-Key Envelope mirror to
`active_revision`. Server-side WebAuthn assertion verification remains
optional — it is device-ceremony integrity, not a replacement for client-side
PRF. Vault Key rotation in the PWA is a separate change.
