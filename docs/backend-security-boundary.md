# 4AllPass Backend Security Boundary (v1)

**Status:** Authoritative for backend identity and authorization
**Companion to:** `crypto-protocol.md` §11, `threat-model.md`, `vault-revision.md` §4.1
**Date:** 2026-08-18

`crypto-protocol.md` says what the server may store. This document says who may
ask for it.

The crypto core already assumes a hostile server: every envelope, entry and
manifest is authenticated, and a malicious operator who serves the wrong bytes
is caught by the client (`threat-model.md` §3). That is confidentiality against
the *operator*. It says nothing about one account reading another account's
ciphertext — an authorization question the crypto layer deliberately does not
answer. This is the layer that does.

---

## 1. The boundary

```
                 ┌──────────────────────┐
                 │      Browser         │
                 │                      │
                 │  Account sign-in     │
                 │        │             │
                 │        ▼             │
                 │  Session cookie      │
                 │        │             │
                 │        ▼             │
                 │  API                 │
                 └────────┼─────────────┘
                          │
                          ▼
                    ┌───────────┐
                    │ Backend   │
                    │           │
                    │ Auth      │   who is calling
                    │ AuthZ     │   may they ask
                    │ Ownership │   whose data is it
                    │ Sync      │   opaque blobs in / out
                    └─────┬─────┘
                          │
                    encrypted only
                          │
                          ▼
                    ┌───────────┐
                    │ Database  │
                    └───────────┘

              Client-side only:
                    Master Password
                    VK / DK / DWK
                    WebAuthn PRF output
                    plaintext entries
```

Every vault- and device-scoped request passes through four decisions, in this
order, before any row is read:

```
request
  → get_current_session   the cookie names a live session
  → get_current_user      that session names an active account
  → require_vault_owner   that account owns this vault
  → device scoped to vault
  → encrypted data
```

### Authentication ≠ Vault decryption

This is the invariant the whole document exists to protect, and it is
`crypto-protocol.md` Hard Invariant #5 restated for the server:

> The backend authenticates the user. It does not obtain the Vault Key.

A session proves identity. It does not, and cannot, decrypt anything. Compromise
the account layer completely — steal the session cookie, steal the account
password, take over the database — and what you get is the set of encrypted
blobs that account already owned. The Master Password was never sent, the Vault
Key was never derivable, and the offline attack on Argon2id is still the only
way in (`threat-model.md` §4).

### What the server can see

| | |
|---|---|
| Account identity | e-mail, Argon2id hash of the **account** password, active flag |
| Sessions | SHA-256 digest of a session token, expiry, last use, user-agent summary |
| Vault metadata | vault id, owner, `crypto_protocol_version`, `active_revision` pointer |
| Device metadata | `deviceId`, display name, last seen, revocation timestamps |
| WebAuthn metadata | credential id, RP id, COSE public key, PRF/largeBlob capability flags |
| Opaque blobs | key envelopes, encrypted entries, sealed manifests, Device-Key Envelope mirrors |

### What the server cannot see

Master Password · Vault Key (VK) · Device Key (DK) · Device Wrapping Key (DWK) ·
WebAuthn PRF output · Recovery Key · plaintext entries.

None of these has a field in any request schema, a column in any table, or a
code path that could produce one. The server is not an encryption oracle
(`webauthn-prf.md`, top) and holds no key that decrypts a vault.

---

## 2. Session model

**Decision: opaque random tokens in an `HttpOnly` cookie, with session state in
PostgreSQL. No JWT. No signing secret.**

A session token is 32 bytes of CSPRNG output, base64url-encoded into the cookie.
The server stores `SHA-256(token)` in `user_sessions` and nothing else.

Why this and not a signed, self-contained token:

| Requirement | Server-side session | JWT |
|---|---|---|
| Logout takes effect immediately | delete the row | needs a revocation list — the session table again |
| "Sign out everywhere" | delete by `user_id` | same |
| Disabling an account ends its sessions | checked on every request | not until the token expires |
| Database dump yields no usable credential | only digests are stored | signing key compromise forges any identity |
| Secrets to manage | none | a signing key to rotate and distribute |
| Survives a Redis restart | yes (Postgres) | n/a |

Revocation is not a nice-to-have for a password manager, and every mechanism
that gives a stateless token real revocation ends up being a session table with
extra steps. So it is a session table.

Redis stays in the stack for what it is good at: ephemeral, reconstructible
state such as rate limiting and WebAuthn challenges. Signing every user out
because a cache restarted is not acceptable, which is why sessions are not
there.

### Cookie attributes

| Attribute | Value | Why |
|---|---|---|
| `HttpOnly` | always | script cannot read the token, so an XSS payload cannot exfiltrate a long-lived credential — and vault code on the page cannot reach it either |
| `Secure` | on unless `FOURALLPASS_ENVIRONMENT` is a development environment | an unrecognized environment name fails closed |
| `SameSite` | `lax` | blocks cross-site `POST`; still allows the top-level navigation a user expects to arrive signed in. `none` is rejected at startup unless `Secure` is also set |
| `Path` | `/` | one session for the whole API |
| `Max-Age` | `session_ttl_seconds` (14 days) | matches the server-side `expires_at`, which is what is actually enforced |

The token is read from the cookie and from nowhere else — no `Authorization`
header fallback, no query parameter. A session token therefore cannot end up in
a URL, an access log, a `Referer` or a bookmark.

### Lifecycle

| Event | Effect |
|---|---|
| Login | any session token presented with the request is deleted, then a fresh one is minted — session fixation |
| Each request | expiry checked server-side; `last_used_at` rewritten at most once per `session_touch_interval_seconds` |
| Expiry | the row is deleted on the first request that finds it stale |
| Logout | the row is deleted and the cookie is cleared |
| Logout-all | every row for the account is deleted |
| Account deactivated | `is_active` is checked on every request, so live sessions stop working at once |
| Account deleted | `ON DELETE CASCADE` removes the sessions with it |

Sessions are deleted rather than tombstoned. A revoked session has no further
use, and keeping its digest only extends how long a stale credential is worth
attacking.

### CSRF

Choosing a cookie buys `HttpOnly` and costs a CSRF surface. `SameSite=Lax`
covers the common cases but is a per-browser policy and does not stop a
same-site attacker on a sibling subdomain, so the server checks for itself:
state-changing requests whose `Origin` (or `Referer`) is present and is neither
the deployment's own origin nor an explicitly configured one are refused with
`403`.

Safe methods are exempt, which keeps CORS preflight working. A request with no
`Origin` and no `Referer` is allowed: browsers always send `Origin` on
cross-origin requests and on same-origin state changes, so absence means a
non-browser client, which has no ambient cookie to ride on.

Origins are compared by host and port, not by scheme, because a TLS-terminating
reverse proxy routinely forwards `http` while the browser reports `https`. That
does not weaken the check: a page can only make the browser send a given
`Origin` by actually being served from it, and it can never choose the victim's
`Host` header.

---

## 3. Authentication model

`POST /auth/register` · `POST /auth/login` · `POST /auth/logout` ·
`POST /auth/logout-all` · `GET /auth/me`

Account passwords are hashed with **Argon2id** (`argon2-cffi`), stored in PHC
form, with parameters that are configuration, not protocol. Logging in
re-hashes transparently when the parameters have since been raised.

**The account KDF and the vault KDF are separate concerns.** They share an
algorithm name and nothing else:

| | Account password | Master Password |
|---|---|---|
| Runs on | the server | the client |
| Purpose | verify a login | derive the Master Key that unwraps the Master Envelope |
| Parameters from | `app/core/config.py` | inside the Master Envelope (`crypto-protocol.md` §4) |
| Tuned for | many concurrent verifications | one derivation per unlock |
| Reaches the other side | never | never |

The vault profiles of `test-vectors-argon2id.md` are deliberately **not** reused
here. Sharing them would tie a server-side capacity decision to a client-side
security parameter, and any future change to one would silently be a change to
the other.

Other properties:

- Login answers `401` with one message for "no such account" and for "wrong
  password", and spends a full dummy verification when the account does not
  exist, so neither the body nor the timing is an account-existence oracle.
- A deactivated account cannot log in and cannot use an existing session.
- Registration does not log the caller in, so a session is minted in exactly one
  place and fixation has exactly one place to be handled.
- E-mail is normalized to lowercase at the edge, so the unique index means what
  it looks like it means.
- Passwords, tokens and hashes are never logged. Only the Argon2id hash is ever
  bound into SQL, and only the SHA-256 digest of a token — so even with
  SQLAlchemy's statement log at `DEBUG`, neither the password nor the token can
  appear.

---

## 4. Authorization model — vault ownership

```python
require_vault_owner(vault_id, current_user, db) -> Vault   # or 404
```

Rules:

- A vault belongs to exactly one account. The owner is matched **inside the
  query** (`WHERE id = :vault_id AND owner_user_id = :current_user`), so there
  is no window in which a non-owned vault is loaded and waiting on a later
  check.
- `owner_user_id` is never read from a request. It comes from the session.
- **"No such vault" and "not your vault" produce the same `404`.** A `403` would
  confirm that an id names a real vault, and vault ids would become
  enumerable. One answer for both means walking the id space yields nothing.
- Authentication is checked before ownership, so an unauthenticated caller gets
  `401` for real and imaginary ids alike.
- The check runs as a dependency, before the handler body, so no vault, device
  or snapshot row is read before the decision is made.

---

## 5. Device authorization

`GET /vaults/{vault_id}/devices` and `GET /vaults/{vault_id}/devices/{device_id}`
now require:

```
authenticated account → owns this vault → device belongs to this vault
```

The first two come from `Depends(get_owned_vault)`. The third is in the query
itself: `device_id` is only ever matched together with the authorized
`vault.id`, so a device id borrowed from another vault selects nothing.

Responses carry metadata only — device id, display name, last seen, revocation
timestamps, WebAuthn capability flags, and a boolean for whether a Device-Key
Envelope is on file. Not the envelope's bytes, not the COSE public key, not the
raw credential id, and never DK, DWK, VK or PRF output. The cryptographic
envelope formats are untouched; this milestone changed who may ask for them, not
what they are.

---

## 6. Vault creation

`POST /vaults` creates ownership metadata. That is the whole of the server's
part.

- No Vault Key is generated or received. VK is 256 random bits produced on the
  client (`crypto-protocol.md` §2, Hard Invariant #1) and reaches the server only
  wrapped inside envelopes it cannot open.
- The request body has no field for key material, and `extra="forbid"` rejects
  one that is invented.
- A new vault has no snapshot, so `active_revision` is `null`. That is the
  honest representation of "the client has not published revision 1 yet".

Snapshot commit, envelope upload and the compare-and-swap of `active_revision`
(`vault-revision.md` §4.1, requirements B1–B9) are the **next** milestone and are
deliberately not implemented here. Inventing a storage format for them ahead of
the protocol would be exactly the wrong move.

---

## 7. Attack classes and residual risks

### Defended

| Attack | Defence |
|---|---|
| IDOR on vaults | ownership matched in the query; `404` for foreign ids |
| Horizontal privilege escalation | identity comes only from the session |
| User-id spoofing (body, query, header) | `get_current_user` reads the session row; nothing else is an identity |
| Vault-id enumeration | identical `404` body and status for missing and foreign vaults |
| Device access across users | vault ownership checked before the device query |
| Device-id reuse across vaults | `device_id` always matched with the authorized `vault_id` |
| Mass assignment | `extra="forbid"` on every request schema |
| Session fixation | the presented token is destroyed and a new one minted on login |
| Session replay after logout | the row is deleted; the digest no longer resolves |
| Expired session reuse | `expires_at` enforced server-side, row swept on use |
| Missing authentication | dependency-level, so a route cannot forget it |
| Session token theft via script | `HttpOnly` |
| Session token in logs / URLs | read from the cookie only |
| CSRF | `SameSite=Lax` plus a server-side origin check |
| Account enumeration on login | one answer, one timing |
| Secret leakage in responses | explicit response models; no ORM object is serialized directly |
| Secret leakage in logs | only hashes and digests are ever bound into SQL |

### Residual risks

| Risk | Status | Note |
|---|---|---|
| Registration is an account-existence oracle | accepted for now | `409` on a duplicate e-mail. The alternative — claiming success — leaves the caller unable to log in. Closing it properly needs e-mail confirmation, which v1 does not have (`crypto-protocol.md` §6 rules out e-mail-based *recovery*, not e-mail verification) |
| No rate limiting or lockout on login | **open** | Argon2id makes each attempt expensive, but nothing yet caps the rate. Redis is already in the stack for this; it is the first thing to add |
| Account addresses must be globally deliverable domains | accepted | strict validation rejects `.local`, `.test`, `.invalid`. One canonical form per account keeps the unique index meaningful; the cost is that a self-hosted deployment needs a real domain for account identifiers |
| XSS while the vault is unlocked | accepted (platform limit) | `HttpOnly` protects the session token, not the Vault Key. An attacker with script execution in an unlocked tab has the plaintext — unchanged from `threat-model.md` §5 |
| Session lifetime is absolute, not idle-based | accepted | 14 days, no sliding idle timeout. `last_used_at` is recorded so an idle policy and a session-management UI can be added without a migration |
| Expired rows accumulate until touched | minor | an expired session is deleted by the first request that presents it; there is no periodic sweep yet, and `expires_at` is indexed so one is cheap to add |
| No audit log of authentication events | open | on the roadmap alongside audit logs generally |
| Password-change and account-deletion flows | not implemented | out of scope for this milestone |

### Explicitly unchanged

Nothing in `packages/crypto` was touched. The AES-GCM construction, the HKDF
derivations, the WebAuthn PRF construction, the DWK/DK/VK hierarchy, the AAD
encoding, the manifest verification and every public crypto format are exactly
as `adversarial-review.md` left them. No protocol version changed, because no
protocol changed.

---

## 8. Where this lives

```
backend/app/
  api/
    deps.py                  get_current_session, get_current_user, get_owned_vault
    routes/auth.py           register, login, logout, logout-all, me
    routes/vaults.py         create, list, read — ownership metadata only
    routes/devices.py        device metadata, behind vault ownership
  core/
    security.py              Argon2id account hashing, session-token primitives
    sessions.py              session store + cookie
    authz.py                 require_vault_owner
    origin.py                same-origin check for state-changing requests
    config.py                settings; no session signing secret exists
  models/session.py          user_sessions
  schemas/                   strict requests (extra="forbid"), explicit responses
```

Tests: `backend/tests/test_auth.py`, `test_vault_authorization.py`,
`test_device_authorization.py`, `test_session_primitives.py`, and
`test_adversarial_security_boundary.py` — the last in the spirit of
`packages/crypto/test/adversarial-*.test.ts`, one group per attack class.

---

## 9. Next milestone

Snapshot sync, which is where `vault-revision.md` §4.1 becomes code:

1. `POST /vaults/{id}/snapshots` — upload a complete revision `N+1`
   (envelopes + entries + sealed manifest) as one unit.
2. Compare-and-swap `active_revision` from `N` to `N+1`, only after every part
   is durable (B2, B3).
3. One snapshot per `(vault_id, revision)`, rejected rather than merged (B5), so
   the server cannot equivocate.
4. Reads served from exactly one revision (B4).
5. Rate limiting on the authentication endpoints.

None of it changes the crypto protocol. All of it is storage discipline the
client can already detect the absence of.
