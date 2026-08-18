# Backend Security Boundary v1

**Companion to:** `architecture.md`, `crypto-protocol.md`, `threat-model.md`  
**Date:** 2026-08-18  
**Status:** Implemented for the FastAPI service. Not a production-readiness claim.

This document describes the **identity and authorization** layer. It does not
change Crypto Protocol v1. The cryptographic protocol remains authoritative in
`docs/crypto-protocol.md` and `packages/crypto`.

---

## Authentication ≠ Vault Decryption

The backend authenticates an **account**. It never obtains the Vault Key.

| Concern | Mechanism | What it unlocks |
|---|---|---|
| **Account authentication** | Email + account password → server-side session cookie | API access to *that user's* vault metadata and encrypted blobs |
| **Vault decryption** | Master Password / Recovery Key / Device Key on the client | Plaintext entries |

An account-password compromise (or a stolen session cookie) lets an attacker
*fetch ciphertext*. It does not let them decrypt it. That is Hard Invariant #5
of `crypto-protocol.md`.

```
Browser
  │  account password  →  POST /api/v1/auth/login
  │  HttpOnly session cookie
  ▼
Backend   Auth → AuthZ / ownership → encrypted blobs only
  ▼
Database  metadata + opaque snapshots
```

Client-side only: VK, DK, DWK, WebAuthn PRF output, Master Password, plaintext.

---

## 1. Authentication model

Endpoints (mounted under `/api/v1`):

| Method | Path | Session |
|---|---|---|
| `POST` | `/auth/register` | Issues a new session cookie |
| `POST` | `/auth/login` | Issues a new session cookie; revokes the previous cookie value |
| `POST` | `/auth/logout` | Deletes the server-side session and clears the cookie |
| `GET`  | `/auth/me` | Requires a valid session |

- Reuses the existing `User` row (`email`, `account_password_hash`). There is no
  second account abstraction.
- Account passwords are stored as Argon2id **PHC strings** via `argon2-cffi`
  (`app/core/security.py`). This is **not** the vault Argon2id KDF: it does not
  use the Master Envelope profiles, NFC rules, or parameter digest of
  `crypto-protocol.md` §4.
- Emails are stored lowercased. Duplicate registration is `409`.
- Failed login is always `401` `"invalid credentials"` (unknown email and wrong
  password share one response). A dummy verify runs when no hash exists so the
  timing path still hits Argon2id.
- Request bodies use `extra=forbid`. `userId`, `ownerId`, `isActive`, and
  `accountPasswordHash` cannot be mass-assigned.
- Passwords, session ids, and hashes are never written to application logs by
  the auth/session modules.

---

## 2. Session model

**Decision: opaque server-side sessions in HttpOnly cookies. No JWT.**

A self-hosted browser app needs revocation (logout, re-login, inactive user)
without a token-denylist bolted onto JWTs. Redis already exists for short-lived
non-key-material state. The session id is a 256-bit `token_urlsafe` value.

| Property | Value |
|---|---|
| Cookie name | `fourallpass_session` |
| HttpOnly | yes |
| Secure | yes when `FOURALLPASS_ENVIRONMENT=production` |
| SameSite | `Lax` (same-site PWA + API; Vite proxies `/api`) |
| Path | `/` |
| Max-Age | `FOURALLPASS_SESSION_TTL_SECONDS` (default 14 days) |
| Storage | Redis (`sess:<HMAC-SHA-256(session_secret, token)>`) or in-memory for pytest |

The cookie value is **not** returned in JSON. The frontend must not put a
session secret in `localStorage` or `sessionStorage`.

Lookup hashes the cookie with `session_secret` before it touches Redis, so a
Redis dump is not a pile of replayable cookie values.

On login/register the previous cookie, if any, is revoked (session fixation).
Logout deletes the Redis/memory key; reuse after logout is `401`.
TTL expiry is `401` with the same body as a missing cookie (`not authenticated`).

`FOURALLPASS_SESSION_SECRET` must not stay at the development default in
production — the process refuses to start.

---

## 3. Authorization model

`get_current_user()` (`app/api/deps.py`):

1. Reads the session cookie (never a client-supplied `user_id`).
2. Loads the session record.
3. Loads the `User` row.
4. Rejects missing, invalid, expired, deleted, or inactive sessions with `401`.

`require_vault_owner(vault_id, current_user)` (alias: `get_owned_vault`):

1. Loads the vault whose `id` is the path parameter **and**
   `owner_user_id == current_user.id`.
2. Missing and foreign vaults both return `404` `"vault not found"`.
3. This runs **before** snapshot, device, or envelope payloads are assembled.

Vault creation (`POST /api/v1/vaults`) sets `owner_user_id` from the session.
The body cannot carry an owner. The server generates no Vault Key and accepts
no plaintext entries.

---

## 4. Device authorization

`GET/POST /api/v1/vaults/{vault_id}/devices` and nested credential routes
require the same `require_vault_owner` check, then resolve the device **inside
that vault**.

A device id that belongs to another vault, or a vault the caller does not own,
is `404`. Responses expose device metadata and encrypted-envelope *presence*
flags only — never DK, DWK, VK, PRF output, or account password hashes.
Device-key envelope ciphertext is the client-uploaded opaque blob from
`webauthn-prf.md` §4 (the server cannot unwrap it).

---

## 5. What the server can and cannot see

The server **can** see:

- Email, account password hash, OAuth identifiers (when added later)
- Session records `{user_id, email}`
- Vault ownership and snapshot metadata (`revision`, `vault_key_version`, …)
- Opaque envelopes, entries, and sealed manifests
- Device / WebAuthn credential metadata

The server **cannot** see and must never be given:

- Master Password
- Plaintext vault entries
- Vault Key (VK)
- Device Key (DK)
- Device Wrapping Key (DWK)
- WebAuthn PRF output
- Any key that decrypts a vault without the user’s secrets

---

## 6. Residual risks (this layer)

- Email enumeration on `POST /auth/register` (`409` vs `201`).
- No account-level 2FA yet; rate limits are a coarse IP bucket.
- `SameSite=Lax` is not a CSRF token. It is sufficient while the PWA and API
  share a site; a split-site deployment must revisit this.
- A stolen session cookie is account access, not vault plaintext.
- Redis compromise yields hashed session ids, not vault keys.
- This document does not claim production readiness.

---

## 7. Recommended next milestone

Snapshot-adjacent work is already on the wire (CAS commit). Next product
milestones: WebAuthn *assertion verification* on the server (the PWA already
provisions credentials), audit logs, and rate-limit hardening beyond a single
IP counter.
