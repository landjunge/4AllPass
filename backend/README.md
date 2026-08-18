# 4AllPass Backend

FastAPI + PostgreSQL + Redis backend for 4AllPass. This service is **Zero-Knowledge**: it
never sees plaintext vault entries, the Master Password, the Vault Key, the Device Key, the
Device Wrapping Key, or the WebAuthn PRF output. See the authoritative specs at the repo root:

- [`../docs/architecture.md`](../docs/architecture.md)
- [`../docs/crypto-protocol.md`](../docs/crypto-protocol.md)
- [`../docs/webauthn-prf.md`](../docs/webauthn-prf.md)
- [`../docs/vault-revision.md`](../docs/vault-revision.md)
- [`../docs/threat-model.md`](../docs/threat-model.md)
- [`../docs/backend-security.md`](../docs/backend-security.md) — **what this
  service enforces: authentication, sessions, ownership, device authorization**

> **Authentication ≠ vault decryption.** Signing in proves who is asking. It
> never yields the Vault Key, and no code path here can decrypt a vault.

## What lives here (v1)

- SQLAlchemy 2.0 models + Alembic migrations for the server-storable schema:
  users, vaults, immutable vault snapshots, key envelopes, encrypted entries,
  devices, WebAuthn credentials, and the Device-Key Envelope mirror.
- Account auth (register / login / logout / me) with Argon2id *account*
  passwords and revocable Redis (or in-memory) sessions. This is **not** the
  Master Password and cannot decrypt a vault.
- Sessions ride an **HttpOnly, `SameSite=strict` cookie** for browsers, with a
  session-bound CSRF token on unsafe methods. `Authorization: Bearer` remains
  available as an opt-in (`issueBearerToken: true`) for CLIs and scripts.
- Ownership: every vault/device/snapshot route runs through `get_current_user`
  then `get_owned_vault`, and answers 404 — identically to a vault that does
  not exist — for vaults the caller does not own.
- Snapshot GET + POST with compare-and-swap on `expectedRevision`
  (`docs/vault-revision.md` §4). The server stores opaque ciphertext only.
- Device register / list / revoke, credential metadata, Device-Key Envelope
  mirror. Soft revoke is bookkeeping; cryptographic revoke is the next snapshot
  without that device envelope.
- Explicit response models in `app/schemas/`. Nothing returns an ORM object
  directly, and `CamelModel` sets `extra="forbid"`, so a request body carrying
  `ownerId` is rejected rather than quietly dropped.

Remaining follow-up: WebAuthn ceremony endpoints (attestation / assertion
verification), Vault Key rotation, account password change, and
"sign out everywhere".

## Configuration

Beyond the database and Redis URLs (see `.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `FOURALLPASS_SESSION_SECRET` | dev placeholder | Keys the session-token HMAC. Production refuses to start on the default, or on fewer than 32 characters. |
| `FOURALLPASS_SESSION_BACKEND` | `redis` | `memory` for pytest / single-process dev. |
| `FOURALLPASS_SESSION_TTL_SECONDS` | 14 days | Absolute; requests never extend it. |
| `FOURALLPASS_SESSION_COOKIE_SECURE` | derived | Secure-only when `ENVIRONMENT=production`. |
| `FOURALLPASS_SESSION_COOKIE_SAMESITE` | `strict` | The PWA is served same-origin with the API. |
| `FOURALLPASS_TRUST_PROXY_CLIENT_IP` | `false` | Enable **only** behind a proxy that overwrites `X-Real-IP`, as `frontend/nginx.conf` does. |
| `FOURALLPASS_CORS_ORIGINS` | vite dev server | Lock down in production; the bundled nginx serves the PWA same-origin, so no CORS origin is needed. |

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
