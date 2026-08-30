# Security boundary (implementation)

**Status:** Implemented (this file). Highest authority for “what runs.”  
**Companion to:** `crypto-protocol.md`, `vault-revision.md`, `webauthn-prf.md`, `threat-model.md`  
**Date:** 2026-08-28  
**Index:** [README.md](README.md)

This document describes what the **running backend + PWA / local app** actually enforce.
It does not restate the crypto protocol. If a sentence here disagrees with
`packages/crypto`, the library and its tests win.

**Standing rules**

1. The server stores the vault. The client owns the vault.
2. Agents receive capabilities, not the vault. **Today** that is still a raw-secret handoff after human Allow; TTL does not un-know a copy already given. Mediated proxy is **later**.
3. Identity is shared (later: MAIP). Authorization stays local. **Today** `application: "n8n"` is **not** cryptographic identity.
4. Small core, strict guarantees, optional extensions.

| Component | Plaintext secrets? | Vault Key? | Own policy? |
|---|---|---|---|
| Desktop client | yes (after unlock) | yes (after unlock) | yes |
| Mobile client | later | later | later |
| Browser extension | limited (unlocked fill) | local only | host match |
| Vault server | no | no | storage auth only |
| Hosting provider | no | no | no (placement only; **no Hosted SKU today**) |
| Agent | normally no; v1 grant may copy a secret | no | no |
| Tollgate / Gnom-Hub / MCP | no | no | their domain only; they do not unwrap VK |

Public copy must not exceed this file: **Local-first. Sync optional. Server deiner Wahl.** Desktop = client. Self-host = placement.

---

## 1. Three different proofs

| Proof | Question it answers | Mechanism |
|---|---|---|
| **Authentication** | “This is account X.” | Email + account password → revocable Bearer session |
| **Authorization** | “Account X owns vault Y / device Z.” | Server-side `get_owned_vault`; foreign ids are 404 |
| **Crypto** | “This snapshot is authentic and only an authorized client can decrypt it.” | Client-side AES-GCM, envelopes, sealed manifest |

Authentication is **not** vault decryption. The account password cannot unwrap
a Vault Key **when it differs from the vault password**. Login still sends the
account password to the server (plaintext over HTTPS, then hashed). Creating a
vault refuses an exact match; unlocking an existing vault with a match still
works and warns. A valid session token only authorizes *storage* operations.

**Hosted PWA vs bundled desktop.** A malicious storage operator who also
serves the decrypting JavaScript (same origin `/` + `/api`) can read the vault
password before Argon2id. That is not “the operator does not have the Master
Password.” The desktop app decrypts with **bundled** `frontendDist`; the
sidecar on `:8788` is API. The active-server Zero-Knowledge claim applies to
that bundled client, not to a server-delivered PWA.

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
entries. FastAPI still has no `/v1/access` token route. Local responses send
`Content-Security-Policy` with `connect-src` equal to this process's loopback
origin (not `http://127.0.0.1:*`). The **desktop webview does not navigate**
to the sidecar. UI is the bundled `frontendDist`. Tauri IPC is not granted to
`http://127.0.0.1:8788/**`. If 8788 is already bound before spawn, the app
refuses to start (foreign process). After spawn, TCP-up on 8788 is not trust:
the listener must be the child we spawned (or a descendant). A bind that wins
the window between the free-port check and our listen is the same refuse.
The sidecar is the local API only. Local
Host headers must be loopback (`127.0.0.1` / `localhost` / `::1`).

Local first-run in a **normal browser** skips email and account password.
`POST /api/v1/auth/local` mints a storage session for a singleton row
(`local@127.0.0.1`, no account password hash). That is **authentication for the
blob store**, not vault unlock. The UI never shows that address. Server profile
returns 404 for this route. The **desktop window** does not call that route
(`isTauriShell`): Auth is first, then Create or Unlock. Account password still
cannot unwrap a Vault Key. There is no Welcome screen. Empty vault →
CreateVaultPage (`Ich habe einen Tresor` → restore). Existing vault →
UnlockPage. Access-grant UI shows application / provider / TTL only — not the
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
PRF output. Consume also checks the `deviceId` the challenge was issued for,
when one was bound. That is ceremony hygiene, not a Vault-Key proof. A failed
consume is `console.warn`’d without challenge bytes, vault ids, or API detail;
unlock still proceeds.

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
| **Hard** `hardRevokeDevice` | Verify master (+ recovery if present) → VK+1 → re-encrypt entries → rebuild master/recovery **with the same recovery key** (kit still trusted) → omit target → sealed manifest → **CAS commit**, then metadata DELETE | Snapshot N+1 is sealed under VK₂; holders of VK₁ cannot decrypt it |
| **Compromised recovery** `rotateCompromisedRecovery` | Verify master → VK+1 → **new** recovery key → re-encrypt → CAS | Stolen print unwraps VK₁ only; it must not wrap VK₂ |
| **Trusted kit replace** `replaceTrustedRecoveryKey` | Old key must unwrap current recovery envelope → new print, **same** VK | Convenience; not for a stolen kit |

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

A Device-Key Envelope mirror PUT with `expectedRevision: N` racing a snapshot
`N→N+1` is the same CAS pointer: the PUT is 200 only if it still sees revision
N, otherwise 409 (`test_concurrent_snapshot_commit_and_stale_mirror_put`).
After an omit-envelope commit, GET of that mirror is 404 and PUT at the new
head is 409 (`test_concurrent_omit_envelope_commit_and_mirror_put`). The PWA
order (commit, then PUT) is the one that lands a mirror on the live head.

The server does not open the sealed manifest. It stores the client-supplied
object and returns it unchanged. The client verifies it under VK
(`verifySnapshotManifest`) before pinning `revisionFromManifest`.

Once the local pin stores a `manifestDigest`, a later `GET` that omits
`sealedManifest` is `IntegrityError` — even if the claimed `revision` is
higher. That is not an advance. The pin is not rewritten. Unlock decrypts the
records `verifySnapshotManifest` returned, not a second copy of the GET
payload. A first pin without a digest (legacy snapshot, no manifest yet) still
pins the server integers; after the first verified manifest that path is closed.

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
  WebAuthn credential. Stolen token + stolen device id still works. A VK++
  snapshot alone does **not** drop other sessions; metadata `DELETE /devices`
  does (`test_hard_revoke_snapshot_does_not_kill_sessions_until_metadata_delete`).
  Re-POSTing the same `deviceId` after revoke is one row (`uq_devices_vault_device_id`);
  two concurrent re-enrols both 200 (`test_concurrent_reenrol_same_device_id_one_row`).
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
  `@4allpass/crypto`. Unlock uses the same open order as the PWA: freshness pin
  (`chrome.storage.local`) → unwrap → sealed manifest → decrypt the records
  verification returned. Unlocked entries sit in service-worker memory until
  Lock, 5 minutes idle, or worker eviction — not in extension storage. Closing
  the popup does not lock (shortcut fill still works until idle). Fill matching
  uses the entry URL host first, then a high-confidence provider bridge from
  the stored URL (a `providerId` tag cannot override a conflicting host). A
  TLD-only saved host (`https://com`) does not suffix-match. Shared-parent
  hosts (`github.io`, `vercel.app`, …) do not suffix-match either. An HTTPS
  vault URL is not filled into `http://` of the same host (loopback HTTP is
  allowed). The content script refuses a fill whose `expectedOrigin` is not
  `location.origin`, so a tab that navigated after matching does not receive
  the password. The popup may show a provider/kind **suggestion** from URL +
  field *names* + title (`detectSetup` in `@4allpass/providers`). Field values
  are not inputs. A single env-style name (`OPENAI_API_KEY`) is not high
  confidence. Filling still requires **Auswählen / Fill**. API-key fill uses
  only vault rows with `kind: "api"` for that provider, into the named field,
  still with `expectedOrigin`. Privileged extension messages (`unlock`,
  `fill-tab`, `suggest-active`, `accept-suggestion`, …) from a content-script
  sender (`sender.tab`) are rejected. After a successful
  fill, the page JavaScript can read the input (`input.value`, listeners).
  That is the **final autofill trust boundary**, not a 4AllPass bug — the
  website never receives the vault, only field values in its own DOM.
  DevicesPanel treats missing `getClientCapabilities` PRF as unproven, not as
  “PRF exists” because `PublicKeyCredential` is present. JavaScript cannot
  securely zeroize strings. iOS Safari Web Extension and system Password
  AutoFill are not shipped.
- Native browser import copies Login Data / key4.db into an owner-only temp
  dir (`0700`), overwrites those files before unlink, and zeroizes Keychain /
  Firefox key material after use. `BrowserLogin` Debug prints `***` for the
  password. JavaScript still receives plaintext passwords over Tauri IPC for
  the import-review UI (no password column in the list). SSD wear-leveling
  means overwrite is best-effort.
- AES-GCM nonce budget (`SEALS_PER_KEY_MAX` ≈ 2^32) is **policy**, not a
  persistent per-VK counter. Human-scale edits are far below it. Automated
  high-volume writers must rotate the Vault Key themselves (F-25).
- Copied passwords and recovery keys go to the OS clipboard. The PWA overwrites
  that clipboard after 30s and on lock **if** it still matches. Other apps may
  already have read it. No clipboard-read permission → no overwrite.
- After unlock, the vault desk may check passwords against Have I Been Pwned
  range API: only the first 5 hex chars of SHA-1(password), with `Add-Padding`.
  The 4AllPass server never receives the password or the hash. Offline, the
  “leaked” category is skipped. This is not a cryptographic proof.
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
access broker still needs the unlocked process). Inactivity auto-lock does
**not** run in the desktop app. **Launch at login** (Settings, default off)
starts the process hidden in the tray. It does not unwrap the Vault Key, does
not skip the password, and does not auto-allow. A cold start after login is
LOCKED until the user unlocks. The desktop vault locks on **manual Lock**
only. Sleep, screen lock, tray hide, inactivity, and switching to the
browser do **not** lock. A >5s wall-clock stall used to emit `desktop-lock`;
macOS App Nap suspends the process while Chrome is in front, so that path
zeroized the Vault Key by mistake and is gone.
The UI calls the same lock path and zeroizes the in-process Vault Key as well as
JS allows. A pending access prompt is denied. That is not FileVault and not
hibernation-safe: RAM still holds VK across sleep until the user presses Lock.
An access request opens a small always-on-top prompt with Allow / Deny;
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
Browser `Origin` on the grant path is 403, including `Origin: null`. Pairing token required.
`GET /v1/broker/poll` returns 204 if the UI disconnects. A closed tab must not
dequeue the next grant. The unlocked UI aborts its poll fetch on unmount.
`GET /api/v1/local/broker` returns that pairing token only after **e-mail**
storage auth on the local profile **and** that account owns a vault with an
**active snapshot**. A passwordless `local@127.0.0.1` session is **404**
(same as missing). Throwaway `register` or empty `POST /vaults` is the same
404. The **server** profile does not mount these routes. Grants live in page
memory. Policy evaluation is `@4allpass/core` (`evaluatePolicy` / `decideAccess`):
unknown app DENY, missing scope DENY. `handoff: "mediated"` is **denied**
(`handoff_unavailable`) — v1 has no proxy that uses the secret on the agent's
behalf. Omitted or `raw_secret` stays the n8n path. `decision: "allow"` means
the request is eligible for a **human** Allow — it is not auto-handoff. Core
grants have no secret; the unlocked UI still attaches `material` for the
existing broker response. Unknown applications are denied. Audit rows omit the secret.
**PAIRING TOKEN ≠ AGENT IDENTITY.** `application: "n8n"` is policy metadata,
not authentication. The pairing token proves *this process knows the secret*,
not *this is n8n*. Treat it as the **local root-of-access for agents**
(mode 0600 file; also `GET /api/v1/local/broker` after e-mail storage auth
**and** a vault with an active snapshot). A
stolen token plus the string `n8n` is still eligible for a human Allow. That
is V1. Cryptographic agent keys are
[`architecture/adr/ADR-008-agent-identity.md`](architecture/adr/ADR-008-agent-identity.md)
and are **not** built yet. The later profile is [`specs/maip-v0.1.md`](specs/maip-v0.1.md) (experimental draft).
A library prototype for protocol-agnostic requester signatures lives in
`packages/crypto` (`enrollRequester` / `verifyRequesterSignature`). It does
**not** wrap a Vault Key and is **not** wired into the sidecar. Standing
auto-handoff (`decideStandingAccess` in `@4allpass/core`) is the same: policy
only. The running broker still waits for a human Allow. Actuation credentials
never auto-approve on that path.

**TTL is a 4AllPass grant clock, not a provider-token clock.** `ttl` /
`expires_in` stop *later handoffs from this process*. After Allow, n8n already
holds a copy of the vault secret (e.g. a GitHub PAT). 4AllPass does not rotate
or expire that provider credential. A copy already given is not un-known.
The loopback relay is **one-shot**: `waiting[id]` is removed when `decide`
completes. A second `decide` on the same id is 404. The agent cannot re-poll
the same grant. `parseAccessBody` rejects `ttl` above 86400 seconds
(`ttl_too_large`); `issueGrant` also clamps. That still does not expire a
copy already given.

See [`two-minute-demo.md`](two-minute-demo.md) and
[`local-access-broker.md`](local-access-broker.md).

Vite-only dev can still run the Node relay (`npm run broker` → `@4allpass/broker` on `:8787`).
That package queues HTTP; it does not call `evaluatePolicy`. The sidecar
(`backend/app/broker.py`) is what the desktop app starts.

`@4allpass/access` (`fourAllPass.request({ provider, capability, ttl })`) is a
Node client for that relay. It refuses non-loopback URLs, does not set
`Origin`, and redacts grant material in helper output. It is not FastAPI, not
a second policy engine, and not an n8n marketplace node. Application name is
still a string the vault may DENY. The Access tab also copies an **n8n HTTP
Request** recipe (POST JSON, pairing token only in `Authorization`, displayed
curl redacts that token). n8n-in-Docker must not treat container `127.0.0.1`
as the host. See [`local-access-broker.md`](local-access-broker.md).
