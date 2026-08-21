# Security boundary (implementation)

**Companion to:** `crypto-protocol.md`, `vault-revision.md`, `webauthn-prf.md`, `threat-model.md`  
**Date:** 2026-08-18

This document describes what the **running backend + PWA / local app** actually enforce.
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

Production (`profile=server`) refuses to start if `FOURALLPASS_SESSION_SECRET`
is still the insecure default. The **local** profile writes a random secret
into the data directory (`session.secret`, mode 0600) and uses memory sessions.
That secret still cannot unwrap a Vault Key.

**Local profile** (`python -m app.local` / `npm run app`): one origin
`http://127.0.0.1:8788` serves the UI and `/api/v1`. SQLite file in
`~/Library/Application Support/4AllPass/` (macOS), `%APPDATA%\4AllPass\`
(Windows), `~/.local/share/4allpass/` (Linux). Bind is loopback only.
The process still never sees master password, VK, DK, DWK, PRF, or plaintext
entries. FastAPI still has no `/v1/access` token route.

Local first-run skips email and account password. `POST /api/v1/auth/local`
mints a storage session for a singleton row (`local@127.0.0.1`, no account
password hash). That is **authentication for the blob store**, not vault
unlock. The UI never shows that address. Server profile returns 404 for this
route. Access-grant UI shows application / provider / TTL only — not the
secret or a prefix of it.

**I have a vault** on first-run opens a `4allpass-share-v1` file with its share
key, then creates a **new** local vault (new VK, new recovery key) and commits
the decrypted entries under that VK. The share key is not the recovery key.
A printed recovery key without the encrypted blobs cannot recreate the store.

---

## 3. WebAuthn trust boundary

`POST /vaults/{vault_id}/devices` and `POST …/credentials` store **client-asserted
metadata**. The PWA asks the server for a one-time `publicKey.challenge`
(`POST …/webauthn/challenges`) and consumes it after the ceremony. The server
stores `SHA-256(challenge)`, never the raw bytes after issue, and never sees
PRF output.

The server still does **not**:

- treat `prfSupported: true` as proof of possession
- mix the challenge into HKDF / DWK
- verify PRF output (it never sees it)

When the PWA posts a registration response (`clientDataJSON` + `attestationObject`
+ the create challenge), the server verifies `fmt=none` attestation, stores the
COSE public key, and sets `verification: "cose_verified"`. A later `consume` of
an assertion verifies the signature against that key and the issued challenge,
and bumps `signCount`.

`fmt=none` is not hardware attestation. `cose_verified` means **ceremony
integrity**, not “the server unlocked the vault” and not “PRF was checked.”
Rows posted without an attestation remain `client_asserted` / `serverVerified:
false`.

`serverVerified` is `true` only when a COSE public key was stored after a
verified registration. It is not a passkey-login proof.

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

1. Serialize writers. Postgres: `SELECT … FOR UPDATE` on the vault row.
   SQLite (local app / default pytest): the engine opens `BEGIN IMMEDIATE`.
   The CAS comparison is the same on both.
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

Same serialization when the two payloads differ in `vaultKeyVersion` (a normal
same-VK commit vs a hard-revoke VK++ on the same `expectedRevision`). Measured
in `test_concurrent_same_vk_commit_and_hard_revoke_one_wins`: statuses are
`{200, 409}`; the live head is whichever payload held the lock — either VK₁
with both device envelopes, or VK₂ without the revoked device’s envelope. There
is no mixed-version snapshot. The loser retries on `currentRevision` and must
send `vaultKeyVersion >=` the live value (a same-VK retry after a VK++ win is
HTTP 422). The server still does not open envelopes; “rebuild under VK₂” is a
client duty.

The server does not open the sealed manifest. It stores the client-supplied
object and returns it unchanged. The client verifies it under VK
(`verifySnapshotManifest`) before pinning `revisionFromManifest`.

---

## 6. Remaining limitations (honest)

- WebAuthn COSE verification is ceremony integrity (`fmt=none` + assertion
  signature). It is not PRF verification and does not wrap a Vault Key.
  A challenge issued before hard-revoke does not survive metadata DELETE:
  delayed `POST …/challenges/{id}/consume` is HTTP 404 (`credential not found`)
  once `device.revoked_at` or `credential.revoked_at` is set
  (`test_assert_after_hard_revoke_is_not_found`). Between the VK++ snapshot
  commit and that DELETE there is a window where consume can still return 204;
  that is still not unwrap of VK₂.
- Hard revoke does not rewrap foreign device envelopes (or this device’s when
  the DK needs a WebAuthn ceremony); those devices re-enrol after master unlock.
- Account session is bound to a client-asserted `X-Device-Id`, not to a
  WebAuthn credential. Stolen token + stolen device id still works.
- Device-Key Envelope mirror is gated on the active snapshot: PUT requires
  `expectedRevision` and a matching device envelope; GET refuses a missing
  envelope (404) or a stale `deviceKeyVersion` (409). The PWA commits the
  snapshot first, then PUTs the mirror with that revision.
- Bearer token lives in `sessionStorage` (XSS = account takeover, not vault
  plaintext by itself).
- Rate limits are per-IP counters, not a full abuse platform.
- Soft `DELETE` remains `metadata_only` — it is not cryptographic erase.
- The PWA caches the last **verified wire** snapshot in IndexedDB for offline
  unlock. The pin still applies. Plaintext and the Vault Key are not cached.
- The Chromium, Firefox, and **macOS Safari** extension decrypts on-device via
  `@4allpass/crypto`. Unlocked entries sit in service-worker memory until Lock,
  5 minutes idle, or worker eviction — not in extension storage. Closing the
  popup does not lock (shortcut fill still works until idle). Fill matching uses
  the entry URL host, not the page title. JavaScript cannot securely zeroize
  strings. iOS Safari Web Extension and system Password AutoFill are not shipped.
- Copied passwords and recovery keys go to the OS clipboard. The PWA overwrites
  that clipboard after 30s and on lock **if** it still matches. Other apps may
  already have read it. No clipboard-read permission → no overwrite.
- Selective item share is a portable snapshot (`4allpass-share-v1`) plus a
  recovery-encoded share key. It is not uploaded. It does not wrap to a foreign
  Device Key. A copy already given cannot be remotely revoked. See
  [`docs/sharing.md`](sharing.md).

Hard Vault Key rotation in the PWA is implemented (`hardRevokeDevice`) and
exposed as “Rotate vault key” on the devices panel. The Device-Key Envelope
mirror is CAS-tied to `active_revision`. WebAuthn challenges are server-issued
and single-use. Assertions and `fmt=none` registrations are COSE-verified
against that challenge when the PWA sends the authenticator response. That is
ceremony integrity, not a replacement for client-side PRF.

The desktop app (`src-tauri/`, `docs/desktop.md`) loads the same frontend in
a Tauri WKWebView. Measured on macOS 15.7 / this build
(`GET /api/v1/local/webview-caps` after UI boot): `PublicKeyCredential` and
`credentials.create` exist; `isUserVerifyingPlatformAuthenticatorAvailable`
is **false**; `prf` is **null** (no `getClientCapabilities` report). That is
not a successful PRF ceremony. Master-password and recovery-key unlock are
the supported paths in `4AllPass.app`. Do not claim Touch ID / passkey unlock
until a ceremony returns PRF. No new wrap protocol (no “Tauri biometrics
envelope”). Hiding the window to the tray does **not** lock the vault (the
access broker still needs the unlocked process). Inactivity auto-lock still
runs. **Launch at login** (Settings, default off) starts the process hidden in
the tray. It does not unwrap the Vault Key, does not skip the password, and
does not auto-allow. A cold start after login is LOCKED until the user unlocks.
**Screen lock** and **system sleep** emit `desktop-lock` (macOS notify, Windows
input-desktop, Linux logind `LockedHint`, and a >5s **wall-clock** gap between
polls). `Instant` / CLOCK_MONOTONIC stops during suspend with the process, so a
lid-close looks like one 400ms tick and must not be the stall clock.
The UI calls the same lock path and zeroizes the in-process Vault Key as well as
JS allows. A pending access prompt is denied. That is not FileVault and not
hibernation-safe. The race vs actual sleep is real: a dump of RAM after a
missed notification can still hold VK. An access request opens a small always-on-top prompt with Allow / Deny;
that window receives only application / provider / scope / TTL. The grant
material is issued in the unlocked main webview after the prompt event. The
prompt is not a second crypto context.

---

## 7. Local access broker (not FastAPI)

The Access tab and `/agent-request.html` implement `POST /v1/access/request` on
the **unlocked page** via `BroadcastChannel` `4allpass-access-v1`. The local
profile also serves the **same relay** on this process
(`POST /v1/access/request` on `http://127.0.0.1:8788`). That route is a pairing
queue, not a token mint: the server never decrypts, never invents a GitHub
secret, and only forwards a body the unlocked UI posted to `/v1/broker/decide`.
Browser `Origin` on the grant path is 403. Pairing token required.
`GET /api/v1/local/broker` returns that pairing token only after local storage
auth. The **server** profile does not mount these routes. Grants live in page
memory. Policy evaluation is `@4allpass/core` (`evaluatePolicy` / `decideAccess`):
unknown app DENY, missing scope DENY. `decision: "allow"` means the request is
eligible for a **human** Allow — it is not auto-handoff. Core grants have no
secret; the unlocked UI still attaches `material` for the existing broker
response. Unknown applications are denied. Audit rows omit the secret.
Application identity is a string (`n8n`) — spoofable. TTL expiry stops future
handoffs; a copy already given is not un-known. See
[`two-minute-demo.md`](two-minute-demo.md) and
[`local-access-broker.md`](local-access-broker.md).

Vite-only dev can still run the Node relay (`npm run broker` on `:8787`).

`@4allpass/access` (`fourAllPass.request({ provider, capability, ttl })`) is a
Node client for that relay. It refuses non-loopback URLs, does not set
`Origin`, and redacts grant material in helper output. It is not FastAPI, not
a second policy engine, and not an n8n marketplace node. Application name is
still a string the vault may DENY. The Access tab also copies an **n8n HTTP
Request** recipe (POST JSON, pairing token only in `Authorization`, displayed
curl redacts that token). n8n-in-Docker must not treat container `127.0.0.1`
as the host. See [`local-access-broker.md`](local-access-broker.md).
