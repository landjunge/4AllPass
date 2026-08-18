# Backend Security Boundary (v1)

**Companion to:** `docs/architecture.md`, `docs/crypto-protocol.md`, `docs/threat-model.md`, `docs/vault-revision.md`, `docs/webauthn-prf.md`
**Date:** 2026-08-18

This document describes what the **server** enforces. The cryptographic
protocol is specified elsewhere and is authoritative; nothing here changes it.

---

## 0. Authentication ≠ Vault Decryption

This is the single most important sentence in this document:

> **The backend authenticates the account. It never obtains the Vault Key.**

Signing in proves *who is asking*. It does not, and must not, produce anything
that can read a vault. The two live on different keys, in different places, and
fail independently:

| | Account authentication | Vault decryption |
|---|---|---|
| Secret | Account password | Master Password / Recovery Key / Device Key |
| Where it is checked | Server | Client only |
| What it yields | A session | The Vault Key |
| Server can perform it | Yes | **No** — it holds no key that can |
| Compromise means | Attacker can read *metadata* and delete blobs | Attacker can read secrets |

Consequence, restating `crypto-protocol.md` Hard Invariant #5: a stolen account
password, a stolen session cookie, or a malicious operator with full database
access still cannot decrypt a vault. What they get is what §6 lists.

---

## 1. The trust boundary

```
Client
  │
  ▼
Authentication            session cookie or bearer token → SessionRecord
  │
  ▼
Authenticated User        get_current_user()   — never a client-supplied id
  │
  ▼
Vault Ownership           get_owned_vault()    — ownership is in the WHERE clause
  │
  ▼
Device Authorization      device scoped to that vault
  │
  ▼
Encrypted Vault Data      opaque blobs; the server cannot read them
```

Each layer runs before the next, as a FastAPI dependency, so a route cannot
reach data without having passed through all of them. Forgetting the check is
not possible by omission: a route that takes `vault: Vault = Depends(get_owned_vault)`
has already been authorized by the time its body executes.

---

## 2. Authentication

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/auth/register` | Create an account, start a session |
| `POST /api/v1/auth/login` | Start a session |
| `POST /api/v1/auth/logout` | Revoke this session |
| `GET  /api/v1/auth/me` | The authenticated account |

**Password storage.** Account passwords are hashed with Argon2id
(`t=3, m=64 MiB, p=2`) in `app/core/security.py` and never stored or logged in
any other form.

These parameters are deliberately **not** the vault KDF profiles of
`docs/test-vectors-argon2id.md`. The vault KDF defends a stolen database
against an attacker with unlimited offline time, so it is tuned as high as a
client can bear. This one runs on the server on every login request, so it is
tuned to make online guessing expensive without becoming a denial-of-service
lever. Sharing one number would let a server capacity decision silently weaken
vault encryption.

**Account enumeration.** A login for an address with no account performs a
decoy Argon2id verification, so the response time does not separate "no such
account" from "wrong password", and both return an identical `401`.

Registration is the deliberate exception: it answers `409` for an address that
is taken, because a self-hosted instance has to be able to tell a user that
they already have an account. See §7.

**E-mail addresses.** Parsed in `app/core/emails.py`. Special-use domains
(`.local`, `.test`) are accepted because a self-hosted instance on a LAN or in
a homelab uses them, and deliverability is never checked because a DNS lookup
would fail closed on an air-gapped host. Addresses are canonically lower-cased,
which the `ck_users_email_is_lowercase` constraint keeps true — that is what
makes the unique index on `users.email` a case-insensitive one.

---

## 3. Sessions

**Decision: opaque, server-side, revocable sessions in an HttpOnly cookie.**

Not JWTs. A JWT would move session state to the client and buy stateless
verification, which this application does not need — it already has Redis, it
runs as a single self-hosted service, and it needs *revocation* (logout, device
loss) far more than it needs statelessness. A revocable JWT is a session store
with extra steps.

### Cookie attributes

| Attribute | Value | Why |
|---|---|---|
| `HttpOnly` | yes | Script on the page cannot read the session |
| `Secure` | in production | Derived from `FOURALLPASS_ENVIRONMENT`; a plain-HTTP dev box still works |
| `SameSite` | `strict` | The PWA is served same-origin with the API, so nothing legitimate is cross-site |
| `Max-Age` | `session_ttl_seconds` (14 d) | Absolute, see below |

The predecessor design returned the token in the response body and the PWA kept
it in `sessionStorage`. Anything the page can read, a script on the page can
exfiltrate and keep. `HttpOnly` removes that whole class of outcome, which is
why the browser flow no longer receives a token at all.

**Bearer tokens still exist**, as an opt-in: a client that sends
`issueBearerToken: true` gets the token in the response body and can use
`Authorization: Bearer`. That is for CLIs, scripts, and tests. Browsers leave
it false.

### Storage

The token is never stored as presented. Redis holds
`{user_id, email, csrf_token_hash, created_at}` under `HMAC-SHA256(session_secret, token)`,
so a database dump cannot be replayed as credentials. The CSRF token is stored
the same way, for the same reason.

`FOURALLPASS_SESSION_SECRET` keys that HMAC, so a production instance refuses
to start on the built-in default or on a secret shorter than 32 characters.

### Lifetime and revocation

Expiry is **absolute**: the TTL is fixed at creation and no request extends it,
so a stolen session has a bounded life even if the thief keeps it active.

- Logout revokes the session server-side and clears both cookies. It is
  idempotent and works on an already-invalid session, so a user whose session
  expired can always return to a clean state.
- Logout is **per session**, so signing out one browser does not sign out the
  others.
- Deactivating an account (`is_active = false`) invalidates its sessions on
  their next request.
- **Session fixation** is not possible: authenticating always mints a fresh
  token and never adopts a caller-supplied identifier.

### CSRF

Cookies are ambient — the browser attaches them to cross-site requests too —
so moving to cookies introduces CSRF. Two mechanisms, deliberately both:

1. `SameSite=strict` stops the browser sending the session cookie cross-site
   at all. Primary defence.
2. A CSRF token, required on unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`)
   for **cookie-authenticated** requests. The page reads it from the
   script-readable `4allpass_csrf` cookie and echoes it in `X-CSRF-Token`.

The token is compared against the value bound to *that session*, not merely
against the cookie. Plain double-submit assumes nobody else can write the
victim's cookies, which a same-site subdomain attacker can; binding to the
session removes the assumption.

Bearer callers are exempt. An `Authorization` header is not ambient authority —
a cross-site page cannot cause it to be attached.

---

## 4. Authorization

### `get_current_user()`

The authenticated identity comes from the server-side session record and
nowhere else. No path parameter, query parameter, or body field is ever
consulted to decide *who* is calling.

### `get_owned_vault(vault_id)`

```python
select(Vault).where(Vault.id == vault_id, Vault.owner_user_id == user.id)
```

Ownership is part of the query, not a check performed after loading, so no code
path ever holds another account's `Vault` object.

**A vault that exists but belongs to someone else, and a vault that does not
exist, return the identical `404 {"detail": "vault not found"}`.** Not `403`:
distinguishing them would turn the endpoint into an oracle for which vault ids
exist. Combined with random UUID ids, there is nothing to enumerate.

### Device authorization

Every device route sits behind `get_owned_vault`, and the device is then looked
up **scoped to that vault**:

```python
select(Device).where(Device.vault_id == vault.id, Device.device_id == device_id)
```

Device ids are only unique within a vault, so a lookup by id alone would let an
attacker read a victim's device through their own vault — with the ownership
check present and passing. The scoped query is what makes the chain
*authenticated → owns vault → device belongs to vault* actually hold.

### Mass assignment

Every request schema derives from `CamelModel`, which sets `extra="forbid"`.
A body containing `ownerId`, `userId`, or `id` is rejected with `422` rather
than silently dropped. No schema exposes an ownership column today; forbidding
extras is what keeps that from becoming a vulnerability the day one does.

`POST /vaults` takes no body at all — ownership comes from the session.

---

## 5. Throttling

Two buckets per attempt, because they catch different attacks: one keyed on the
caller's address (one attacker, many accounts) and one keyed on the targeted
account (many addresses, one account — a distributed password spray, which an
address bucket never sees). The account key is hashed, so the store never holds
a list of which addresses were tried.

Behind a reverse proxy, the caller's address is the proxy's. Set
`FOURALLPASS_TRUST_PROXY_CLIENT_IP=true` **only** when every request passes
through a proxy that overwrites `X-Real-IP` / `X-Forwarded-For`, as the bundled
`frontend/nginx.conf` does. On a directly-exposed server, trusting that header
would let callers mint unlimited buckets for themselves.

---

## 6. What the server can and cannot see

### Can see

- Account e-mail, Argon2id password hash, account timestamps
- Which vaults exist and who owns them
- Vault metadata: `revision`, `vault_key_version`, `crypto_protocol_version`
- Device metadata: device id, label, platform, user-agent summary, last seen,
  revocation state
- WebAuthn credential ids, RP id, capability flags
- Argon2id **parameters and salt** (inside the master envelope — parameters,
  never a key)
- Sizes, counts, and timing of encrypted objects

### Cannot see

- Master Password
- Vault Key (VK)
- Device Key (DK)
- Device Wrapping Key (DWK)
- WebAuthn PRF output
- Recovery Key
- Plaintext vault entries, or any field within them

The server stores envelopes and entries as opaque `nonce || ciphertext || tag`
and has no key that opens any of them. This is the same boundary
`crypto-protocol.md` §11 and `threat-model.md` §3 already specify; the
authorization layer added here does not widen it.

**Vault creation generates no key material on the server.** `POST /vaults`
writes an ownership row and nothing else. The client generates the Vault Key,
wraps it, and uploads the result as a snapshot.

---

## 7. Residual risks

| Risk | Status | Note |
|---|---|---|
| Registration reveals that an address is taken | Accepted | `409` is needed for a usable self-hosted signup; login does not distinguish, and throttling applies |
| XSS in the PWA | Accepted (pre-existing) | The cookie is unreadable, but a script on an unlocked page can read vault plaintext directly — `threat-model.md` §2.4 |
| Login CSRF | Accepted | An attacker can cause a cross-site login attempt into *their* account; `SameSite=strict` plus a same-origin SPA make it hard to exploit and the impact is confusion, not disclosure |
| Account compromise reveals metadata | Accepted by design | Device names and revision history are visible; no vault content is |
| Session lifetime is 14 days | Accepted | The cookie is HttpOnly and absolute-expiring; vault auto-lock is a separate, much shorter client-side timer |
| `cors_origins` defaults to the dev server | Deployment concern | Restrict it in production; the bundled nginx serves the PWA same-origin, so no CORS origin is needed at all |
| No session listing / "sign out everywhere" | Open | Needs a per-user session index; logout is per session today |
| No account password change / rotation endpoint | Open | Would also need to revoke that account's other sessions |
| Rate limits are per instance, in Redis | Accepted | Adequate for self-hosting; not a substitute for a WAF on a public deployment |

---

## 8. Relationship to other documents

| Document | Responsibility |
|---|---|
| `architecture.md` | High-level system design |
| `crypto-protocol.md` | Authoritative crypto rules — unchanged by this layer |
| `threat-model.md` | Attackers, assets, malicious server |
| **`backend-security.md`** | **This document — authentication, sessions, authorization** |
| `vault-revision.md` | Snapshots, rollback detection, atomic rotation |
| `webauthn-prf.md` | PRF → HKDF → DWK → DK construction |
