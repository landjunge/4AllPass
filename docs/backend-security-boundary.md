# 4AllPass Backend Security Boundary v1

**Status:** Draft – Security Specification
**Date:** 2026-08-18
**Companion to:** `docs/architecture.md`, `docs/crypto-protocol.md`, `docs/threat-model.md`, `docs/webauthn-prf.md`, `docs/vault-revision.md`

This document describes the **identity, session, and authorization layer** that sits in front of
the vault/device API (`backend/app`). It is *not* a cryptographic specification: nothing here
changes, weakens, or reinterprets `docs/crypto-protocol.md`. Its only job is to answer one
question for every request: *which authenticated account is calling, and is it allowed to touch
this vault / device / snapshot?*

> **Authentication ≠ Vault Decryption.** The backend authenticates the *account* (email +
> account password, independent per crypto-protocol.md Hard Invariant #5) and never obtains the
> Master Password, the Vault Key, the Device Key, the Device Wrapping Key, or any WebAuthn PRF
> output. Authenticating successfully proves "this HTTP client is account X"; it proves nothing
> about the vault's plaintext, which stays entirely client-side.

---

## 1. Trust boundary

```
Client
  |  Authorization: Bearer <session token>
  v
Authentication         (app/api/deps.py:get_current_user)
  |
  v
Authenticated User      (app.models.user.User)
  |
  v
Vault Ownership          (app/api/deps.py:get_owned_vault)
  |
  v
Device Authorization      (routes scoped to the owned vault; app/api/routes/devices.py)
  |
  v
Encrypted Vault Data      (opaque ciphertext + metadata only; app/services/snapshots.py)
```

Every `/api/v1/vaults/**` and `/api/v1/vaults/{id}/devices/**` route is reached only through
`get_current_user` and then `get_owned_vault`; there is no route that accepts a client-supplied
`user_id`, `owner_id`, or `vault_id` as an implicit trust anchor. See §3–§5.

## 2. What the server can and cannot see

| Can see (metadata / ciphertext) | Cannot see (never received) |
|---|---|
| Account email, Argon2id **account**-password hash | The Master Password |
| Session tokens (hashed at rest, see §3) | Plaintext vault entries |
| Vault id, ownership, `active_revision`, `vaultKeyVersion` | The Vault Key (VK) |
| Snapshot ciphertext, nonce, tag, AAD-relevant metadata | The Device Key (DK) |
| Device id, label, platform, revocation timestamps | The Device Wrapping Key (DWK) |
| WebAuthn credential id, RP id, COSE public key, PRF/largeBlob capability flags | The WebAuthn PRF output |
| Device-Key Envelope ciphertext (opaque AES-256-GCM blob) | Any decrypted secret, ever |

The server's role is strictly identity + authorization + metadata + encrypted blob storage
(`backend/README.md`, "What lives here"). It has no code path that decrypts a `KeyEnvelope`,
`EncryptedEntry`, or `DeviceKeyEnvelope`.

## 3. Authentication and session model

**Account passwords** are hashed with Argon2id (`app/core/security.py`, `hash_account_password`)
using an independent parameter profile from the vault KDF. This is a deliberate, explicit split:
the account password authenticates a session; the Master Password (with its own, separately
specified Argon2id profile in `crypto-protocol.md` §2/§9) derives the Master Key that unwraps the
Vault Key. They must never be conflated — see Hard Invariant #5.

**Sessions are opaque, revocable bearer tokens**, not JWTs:

- `POST /auth/login` / `POST /auth/register` mint a random 256-bit token (`secrets.token_urlsafe`)
  and store `{user_id, email}` server-side (Redis in production, in-memory for tests) keyed by an
  HMAC-SHA256 of the token (`token_lookup_key`), so a Redis dump cannot be replayed directly as an
  `Authorization` header, and the raw token is never persisted.
- The client sends the token as `Authorization: Bearer <token>`.
- `POST /auth/logout` deletes the server-side record; the token is immediately unusable
  (`get_current_user` looks the record up on every request — there is no self-contained/stateless
  token that stays valid after logout).
- Sessions expire server-side after `FOURALLPASS_SESSION_TTL` (default 14 days); an expired
  lookup returns `None` and `get_current_user` responds `401`.
- Login and register are rate-limited per client IP (`app/core/sessions.py`,
  `hit_rate_limit`) to slow down credential stuffing and enumeration. The bucket key is the raw
  TCP peer address by default; `FOURALLPASS_TRUST_FORWARDED_FOR` opts into reading
  `X-Forwarded-For` instead, and must only be enabled behind a reverse proxy that overwrites any
  client-supplied value of that header (otherwise a client can spoof it to dodge the limiter).

**Why bearer tokens instead of an `HttpOnly` cookie.** The task's default preference is a secure
`HttpOnly` cookie for browser sessions, and that remains the better default for a typical
same-origin server-rendered app. 4AllPass has a specific reason to deviate for v1:

1. The client is a PWA whose only state-changing calls are already fully explicit,
   attacker-cannot-forge JSON bodies (`frontend/src/lib/api.ts`) — there is no reliance on
   *ambient* browser credentials (cookies sent automatically by the browser on cross-site
   requests). A bearer token that must be attached explicitly by same-origin JavaScript is not
   usable by a CSRF attacker, so the classic reason to add `HttpOnly` cookies (removing the token
   from JS-reachable storage) is traded against **not** having to add CSRF-token
   infrastructure for a single-origin API that has no server-rendered forms.
2. The token is kept in `sessionStorage`, not `localStorage`: it does not persist across browser
   restarts/tabs and is cleared when the tab closes, which bounds the "stolen token" window to a
   single browser session even though the server-side TTL is 14 days.

**This is a real trade-off, not a free lunch:** an `HttpOnly` cookie is strictly better against
token exfiltration via XSS (JavaScript cannot read it at all), whereas the current token is
reachable by any script running in the page. Because 4AllPass's actual crown jewels (VK/DK/DWK,
plaintext entries) never touch this token or this storage, a stolen session token only grants
*account*-level API access (create/list vaults, push opaque snapshots, manage device metadata) —
it can never decrypt a vault. This bounds the blast radius but does not eliminate it. **Moving to
`HttpOnly` + `SameSite=Strict` cookies with double-submit CSRF tokens is the recommended
follow-up** once the frontend has a dedicated auth module to own that complexity (see
`docs/roadmap.md`); it is out of scope for this milestone to avoid a speculative rewrite of the
frontend request layer.

`SameSite`/`Secure` cookie attributes are consequently not yet configured in code because no
cookie is issued; `FOURALLPASS_SESSION_SECRET` only keys the HMAC lookup, and
`FOURALLPASS_ENVIRONMENT=production` is expected to run behind TLS so the `Authorization` header
itself is never sent over plaintext HTTP.

## 4. Authorization

`get_current_user` (an `Authorization: Bearer` dependency) is the only source of identity for
every protected route — no route reads a `user_id` from the request body, query string, or path
and treats it as trusted.

`get_owned_vault` (`app/api/deps.py`) is the single authorization chokepoint for every
vault-scoped route (`/vaults/{vault_id}`, `.../snapshot`, `.../snapshots`, `.../devices/**`). It
loads the vault filtered by `WHERE id = :vault_id AND owner_user_id = :current_user.id` in one
query and returns `404 Not Found` both when the vault does not exist and when it belongs to
someone else — an attacker cannot distinguish "no such vault" from "not yours", which prevents
vault-id enumeration via response-code oracle.

Device and credential routes never take a device query scoped only by its own id; they always
resolve through `(vault=get_owned_vault, device_id)` (`app/api/routes/devices.py:_get_device`),
so a device id can only ever be resolved inside the vault that owns it (also enforced at the data
layer by `uq_devices_vault_device_id`).

## 5. Vault creation

`POST /vaults` takes no client-supplied body. It creates a `Vault` row owned by
`current_user.id` and nothing else — the server never generates, receives, or stores a Vault Key.
The client is solely responsible for generating the Vault Key and pushing the first encrypted
snapshot (`POST /vaults/{id}/snapshots`) using the existing `docs/vault-revision.md` §4 commit
protocol; the server only validates structure (a master envelope must be present) and CAS
(`expectedRevision`), never plaintext.

## 6. API response typing

Every route returns an explicit Pydantic response model (`app/schemas/*.py`), never an ORM
object. In particular, `account_password_hash` has no corresponding field on any response schema,
so it cannot be serialized by construction, and session tokens are only ever returned once, at
mint time (`AccountSession.token`), never on subsequent `GET /auth/me` calls.

## 7. What changed from a plain scaffold, and what did not

Added: `/auth/*`, `get_current_user`, `get_owned_vault`, per-request ownership checks on every
vault/device/snapshot route, Argon2id account passwords, revocable sessions, rate limiting.

Not touched: `packages/crypto`, the AES-256-GCM/HKDF/Argon2id vault KDF constructions, the
WebAuthn PRF / Device Wrapping Key derivation, the envelope/manifest wire formats, or the
snapshot revision protocol. This layer only decides *whether* a request may reach the existing,
unmodified snapshot/device code paths — it does not participate in decrypting anything they
carry.
