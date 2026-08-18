# 4AllPass backend

FastAPI + PostgreSQL + Redis. Stores wrapped envelopes, encrypted entries, and
device metadata. It never sees a master password, a Vault Key, a Device Key,
WebAuthn PRF output, or plaintext entry data.

```
app/
  config.py          settings (env prefix FOURALLPASS_)
  db.py              async engine / session
  redis_client.py    sessions + rate limits
  security.py        account password hashing, session tokens
  errors.py          typed API errors
  models/            accounts, vaults, snapshots, envelopes, devices
  schemas/wire.py    the opaque blob formats (mirrors packages/crypto/src/wire.ts)
  schemas/api.py     request / response bodies
  services/          accounts, sessions, vaults (commit protocol), devices
  api/routes/        health, auth, vaults, devices
alembic/versions/    0001_initial_schema.py
```

## Run

```sh
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
cp .env.example .env
.venv/bin/alembic upgrade head
.venv/bin/uvicorn app.main:app --reload
```

```sh
.venv/bin/pytest          # needs PostgreSQL + Redis
.venv/bin/ruff check .
```

Tests use the database named in `FOURALLPASS_DATABASE_URL` with `_test`
appended by `tests/conftest.py`'s default, and Redis DB 1. They run the real
migration, so the migration itself is covered.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/health` | database + Redis reachability, protocol version |
| `POST` | `/api/v1/auth/register` `/login` `/logout` | account session (not the vault) |
| `GET` | `/api/v1/auth/me` | current account |
| `POST` | `/api/v1/vaults` | reserve a `vault_id` for AAD binding |
| `GET` | `/api/v1/vaults/{id}/snapshot` | the snapshot at `active_revision` |
| `POST` | `/api/v1/vaults/{id}/snapshots` | commit revision N+1 (compare-and-set) |
| `GET`/`POST` | `/api/v1/vaults/{id}/devices` | device identities |
| `POST` | `.../devices/{device_id}/credentials` | WebAuthn credential metadata |
| `PUT`/`GET` | `.../credentials/{credential_id}/device-key-envelope` | opaque PRF mirror |
| `DELETE` | `.../devices/{device_id}` | soft revocation |

Credential ids are base64url without padding in URL paths, standard base64 in
JSON bodies.

## What the server enforces

- **Commit protocol.** `expectedRevision` must equal `active_revision`, the new
  revision must be exactly one higher, and the pointer moves with a
  compare-and-set. Two racing clients produce one `201` and one `409`.
- **No mixed revisions.** Snapshots are immutable and only the one named by
  `active_revision` is served. A pending snapshot is never visible.
- **Vault key versions** stay equal or rotate by exactly one.
- **Structural validation** of every blob: 12-byte nonces, 16-byte tags,
  32-byte wrapped keys, KDF parameters only on the master envelope, `deviceId`
  only on device envelopes, one master per snapshot.
- **KDF floor.** A master envelope below 32 MiB Argon2id memory is rejected, so
  the test-only `ci` profile cannot reach a real vault.
- **Device envelopes** only for registered, non-revoked devices.
- **Mirroring** of a Device-Key Envelope only for the `prf` mechanism.
- **`userVerification`** is stored as required and constrained to true.

The same rules exist as CHECK constraints in the migration, so a bug in this
layer still cannot persist a malformed envelope.
