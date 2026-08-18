# 4AllPass Backend Security Boundary (v1)

**Companion to:** `docs/architecture.md`, `docs/crypto-protocol.md`, `docs/threat-model.md`, `docs/vault-revision.md`, `docs/webauthn-prf.md`
**Date:** 2026-08-18
**Scope:** Account authentication, sessions, and authorization for vault/device APIs. This document changes **nothing** about the crypto protocol; `docs/crypto-protocol.md` remains authoritative for all key material.

---

## 1. The trust boundary

Every vault/device API request passes through this chain — each arrow is an
explicit server-side check, not a convention:

```text
Client
  ↓
Authentication            (session cookie → server-side session store)
  ↓
Authenticated User        (get_current_user)
  ↓
Vault Ownership           (get_owned_vault: vault_id must belong to the user)
  ↓
Device Authorization      (device must belong to the resolved vault)
  ↓
Encrypted Vault Data      (opaque blobs + metadata only)
```

The backend handles **identity, authorization, metadata, and encrypted
blobs**. Nothing else.

## 2. Authentication ≠ Vault Decryption

This is the central invariant of the boundary:

> **The backend authenticates the user but never obtains the Vault Key.**

Two unrelated credentials exist, and they must never be conflated:

| Credential | Purpose | Where it lives | Hashing/derivation |
|---|---|---|---|
| **Account password** | Proves identity to the server (login) | Server stores an Argon2id *hash* (`users.account_password_hash`) | `argon2-cffi` server-side defaults (`backend/app/core/security.py`) |
| **Master Password** | Decrypts the vault | Client only — never transmitted | Client-side Argon2id KDF profiles (`docs/crypto-protocol.md` §9) |

The server-side account-password hashing deliberately does **not** reuse the
vault KDF profiles: authentication hashing and vault-encryption key
derivation are separate concerns with separate parameters and separate code.
Compromising the account password (or the server) authenticates an attacker
— it never decrypts a vault (Hard Invariant #5, `crypto-protocol.md`).

### What the server can see

- Email address, account-password **hash**, OAuth identifiers (account layer)
- Vault metadata: ids, ownership, `crypto_protocol_version`, `active_snapshot_id`
- Device metadata: stable `device_id` string, display name, timestamps, revocation bookkeeping
- WebAuthn credential ids / COSE public keys / capability flags (ceremony material)
- Opaque AEAD ciphertexts: key envelopes, encrypted entries, Device-Key Envelope mirrors
- Session tokens it minted itself (stored hashed)

### What the server can never see

- Master Password, in any form
- Plaintext vault entries
- Vault Key (VK), Device Key (DK), Device Wrapping Key (DWK)
- WebAuthn PRF output
- Recovery Key
- Any decrypted envelope content

No endpoint accepts these values, no model stores them, and no response
schema can emit them (see §6).

## 3. Session model

Implemented in `backend/app/core/sessions.py`.

- **Opaque random tokens**, 256 bits from the OS CSPRNG. Tokens carry no
  claims, so there is nothing to sign, parse, or misvalidate — deliberately
  **no JWT infrastructure**.
- **Server-side store:** Redis holds `session:<sha256(token)> → user_id`
  with a TTL (`FOURALLPASS_SESSION_TTL_SECONDS`, default 14 days). Storing
  only the digest means a leaked Redis dump does not yield usable cookies.
- **Transport: HttpOnly cookie** (`fourallpass_session`):
  - `HttpOnly` — JavaScript can never read the token (no localStorage, ever)
  - `Secure` — automatic outside `FOURALLPASS_ENVIRONMENT=development`,
    can be forced with `FOURALLPASS_SESSION_COOKIE_SECURE`
  - `SameSite=Lax` by default (configurable); self-hosted deployments
    serving frontend + API from one site may use `Strict`
  - `Path=/`, bounded `Max-Age`
- **Expiration:** Redis TTL; an expired session is a deleted key and fails
  closed.
- **Revocation:** `POST /auth/logout` deletes the server-side key. A copied
  cookie is dead after logout — revocation is server-side, not cosmetic.
- **Fixation:** structurally impossible — the server never accepts a
  client-chosen session identifier; login always mints a fresh token.
- **No secrets in URLs, no tokens in logs or response bodies.**

Why cookies instead of bearer tokens: this is a browser-first, self-hosted
web app. HttpOnly cookies keep the token out of reach of XSS and out of
client-side storage, and CORS is already locked to configured origins with
`allow_credentials`.

## 4. Authentication endpoints

`backend/app/api/routes/auth.py`:

| Endpoint | Behavior |
|---|---|
| `POST /auth/register` | Creates a user on the **existing** `User` model. 409 on duplicate email. Does *not* create a session. |
| `POST /auth/login` | Verifies the account password, mints a fresh session, sets the cookie. 401 with an identical body for wrong password / unknown email / deactivated account (no user enumeration); unknown emails still cost one Argon2id verification (timing uniformity). |
| `POST /auth/logout` | Revokes the presented session server-side, clears the cookie. Idempotent 204. |
| `GET /auth/me` | Returns the authenticated user. |

## 5. Authorization model

`backend/app/api/deps.py`:

- **`get_current_user`** — resolves the session cookie against Redis, loads
  the active user. The authenticated identity comes *only* from the
  server-side session store; a `user_id`/`owner_id` appearing in a path,
  query, header, or body is never identity.
- **`get_owned_vault`** — the single authorization gate for
  `/vaults/{vault_id}/...`. Ownership is part of the SQL predicate
  (`Vault.id == vault_id AND Vault.owner_user_id == current_user.id`), so no
  code path loads a foreign vault and filters afterwards.

**Anti-enumeration / anti-IDOR:** a vault that exists but belongs to someone
else and a vault that does not exist return the **same 404**. The same rule
applies to devices within a vault. Attackers cannot distinguish "not yours"
from "not there".

**Vault ownership:** `POST /vaults` assigns `owner_user_id` from the session
— the request body is not consulted at all, so a forged `owner_user_id`
cannot even exist as an ignored field. Vault creation stores **ownership
metadata only**: the client generates the Vault Key and later commits the
encrypted snapshot per `docs/vault-revision.md`; `active_snapshot_id` stays
NULL until then.

**Device authorization:** `/vaults/{vault_id}/devices...` requires
authenticated user → owns vault → device belongs to *that* vault. Responses
expose device metadata and *whether* a Device-Key Envelope mirror exists —
never envelope ciphertext, DK, DWK, VK, PRF output, or private credential
material.

## 6. Response schemas as leak barriers

Every endpoint declares an explicit Pydantic `response_model`
(`backend/app/schemas/`). ORM objects are never returned blindly; a field
that is not on the schema cannot leave the server. Audited allow-lists:

- `UserOut`: `id`, `email`, `created_at` — never `account_password_hash`, OAuth subjects
- `VaultOut`: `id`, `crypto_protocol_version`, `active_snapshot_id`, `created_at` — no owner id (redundant for the only caller who can see it)
- `DeviceOut` / `WebAuthnCredentialOut`: metadata + capability flags — no key or credential material

`backend/tests/test_authz.py::test_responses_never_contain_secret_fields`
recursively asserts the absence of secret-bearing keys in live responses.

## 7. Defended attacks (tested)

`backend/tests/test_auth.py` and `backend/tests/test_authz.py` encode the
boundary adversarially (style of `docs/adversarial-review.md`): missing
authentication, cross-user vault reads (IDOR), cross-user device listing,
device ids replayed across vaults, forged `owner_user_id`/`user_id` in
bodies and headers, fabricated session cookies, session reuse after logout,
expired sessions, user enumeration via login responses, secret fields in
responses, and passwords/tokens in logs.

## 8. Out of scope for v1 (known gaps)

- Rate limiting / lockout on `POST /auth/login` (Redis is available; add
  before exposing an instance to a hostile network)
- CSRF hardening beyond `SameSite` (relevant if `SameSite=None` is ever
  configured)
- OAuth login flows (`users.oauth_*` columns exist; endpoints do not)
- WebAuthn *account* authentication (WebAuthn PRF unlock is a client-side
  vault concern, `docs/webauthn-prf.md`)
- Session listing / "log out everywhere"
- Vault snapshot upload/commit (CAS protocol of `docs/vault-revision.md`)
