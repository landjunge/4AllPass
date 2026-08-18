# 4AllPass Backend

FastAPI + PostgreSQL + Redis backend for 4AllPass. This service is **Zero-Knowledge**: it
never sees plaintext vault entries, the Master Password, the Vault Key, the Device Key, the
Device Wrapping Key, or the WebAuthn PRF output. See the authoritative specs at the repo root:

- [`../docs/architecture.md`](../docs/architecture.md)
- [`../docs/crypto-protocol.md`](../docs/crypto-protocol.md)
- [`../docs/webauthn-prf.md`](../docs/webauthn-prf.md)
- [`../docs/vault-revision.md`](../docs/vault-revision.md)
- [`../docs/threat-model.md`](../docs/threat-model.md)
- [`../docs/backend-security-boundary.md`](../docs/backend-security-boundary.md) —
  **authoritative for this service**: authentication, sessions, vault ownership,
  device authorization, and what the server can and cannot see

## What lives here

- SQLAlchemy 2.0 models + Alembic migrations for the full server-storable schema:
  users, sessions, vaults, immutable vault snapshots, key envelopes (master / device /
  recovery), encrypted entries, devices, WebAuthn credentials, and the **Device-Key
  Envelope** mirror (`docs/webauthn-prf.md` §4).
- **Security Boundary v1** — account authentication, server-side sessions, vault
  ownership and device authorization. Every vault- and device-scoped request now has an
  authenticated account and an explicit authorization decision.
- WebAuthn ceremony endpoints, vault snapshot commit/CAS, and rotation are follow-up
  work — see `docs/backend-security-boundary.md` §9.

## API

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /auth/register` | — | create an account (does not sign in) |
| `POST /auth/login` | — | mint a session; sets the `HttpOnly` cookie |
| `POST /auth/logout` | — | revoke this session |
| `POST /auth/logout-all` | session | revoke every session for the account |
| `GET /auth/me` | session | the signed-in account |
| `POST /vaults` | session | create vault ownership metadata |
| `GET /vaults` | session | list the caller's own vaults |
| `GET /vaults/{vault_id}` | session + owner | vault metadata |
| `GET /vaults/{vault_id}/devices` | session + owner | device metadata for that vault |
| `GET /vaults/{vault_id}/devices/{device_id}` | session + owner | one device |

`GET`s that name a vault the caller does not own answer `404`, identically to a
vault that does not exist, so vault ids stay unenumerable.

### Authentication ≠ vault decryption

Signing in establishes *who is asking*. It never yields the Vault Key. The server
never receives the Master Password, VK, DK, DWK or WebAuthn PRF output, and the
account password hash is unrelated to the vault KDF — see
`docs/backend-security-boundary.md` §1 and §3.

## Local setup

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env   # adjust if your Postgres/Redis differ

createuser fourallpass --pwprompt   # if not already present
createdb fourallpass -O fourallpass
createdb fourallpass_test -O fourallpass   # used by the pytest suite

alembic upgrade head
uvicorn app.main:app --reload
```

## Tests

```sh
pip install -r requirements-dev.txt
createdb fourallpass_test -O fourallpass
createdb fourallpass_migrations_test -O fourallpass   # used by tests/test_migrations.py
pytest
```

`tests/test_migrations.py` runs `alembic upgrade head` → `downgrade base` → `upgrade head` →
`alembic check` against a scratch database to catch migration/model drift. Set
`FOURALLPASS_SKIP_MIGRATION_TESTS=1` to skip it in environments without a spare database.

`tests/test_adversarial_security_boundary.py` is the counterpart to
`packages/crypto/test/adversarial-*.test.ts`: one group per attack class (identity
spoofing, IDOR, session forgery, fixation, replay, mass assignment, secret leakage,
cross-site requests). The suite lowers the Argon2id account-hash parameters so
register/login stay fast; production defaults live in `app/core/config.py`.

## Sessions

Opaque random tokens in an `HttpOnly` cookie, with `SHA-256(token)` stored in
`user_sessions`. No JWT and no signing secret — the rationale, the cookie attributes
and the CSRF posture are in `docs/backend-security-boundary.md` §2. `Secure` is on
automatically outside a development environment.

Redis is not involved: it stays for ephemeral state (rate limiting, WebAuthn
challenges), because a cache restart must not sign every user out.

## Database schema — accounts and sessions

| Table | Holds | Never holds |
|---|---|---|
| `users` | e-mail, Argon2id hash of the **account** password, OAuth identifiers | Master Password, any key that decrypts a vault |
| `user_sessions` | `SHA-256(session token)`, expiry, last use, user-agent summary | the session token itself |

`user_sessions` cascades from `users`, so deleting an account signs it out everywhere
as a property of the schema rather than of application code.

## Database schema — Device Envelopes

Two distinct envelope concepts exist per `docs/webauthn-prf.md`, and both are modeled:

| Table | Wraps | Under | Docs |
|---|---|---|---|
| `key_envelopes` (`type = "device"`) | Vault Key (VK) | Device Key (DK) | crypto-protocol.md §3 |
| `device_key_envelopes` | Device Key (DK) | Device Wrapping Key (DWK) | webauthn-prf.md §4 |

The server can decrypt neither: it never holds DK or DWK. `device_key_envelopes` is an
optional mirror of client-held state (webauthn-prf.md §2.1, step 7) that lets a second
browser session on an already-trusted device recover the same convenience-unlock blob.

Supporting tables: `devices` (stable `device_id` bound into both envelopes' AAD) and
`webauthn_credentials` (credential id, RP id, COSE public key, PRF/largeBlob capability
flags — never key material).

## Migrations

```sh
alembic revision --autogenerate -m "message"
alembic upgrade head
```

Review autogenerated migrations by hand — Alembic does not always order circular
foreign keys (`vaults.active_snapshot_id` ↔ `vault_snapshots.vault_id`) or Postgres enum
drops correctly. See the comments in `alembic/versions/*_initial_schema.py`.
