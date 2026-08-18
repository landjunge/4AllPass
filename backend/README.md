# 4AllPass Backend

FastAPI + PostgreSQL + Redis backend for 4AllPass. This service is **Zero-Knowledge**: it
never sees plaintext vault entries, the Master Password, the Vault Key, the Device Key, the
Device Wrapping Key, or the WebAuthn PRF output. See the authoritative specs at the repo root:

- [`../docs/architecture.md`](../docs/architecture.md)
- [`../docs/crypto-protocol.md`](../docs/crypto-protocol.md)
- [`../docs/webauthn-prf.md`](../docs/webauthn-prf.md)
- [`../docs/vault-revision.md`](../docs/vault-revision.md)
- [`../docs/threat-model.md`](../docs/threat-model.md)

## What lives here

- SQLAlchemy 2.0 models + Alembic migration for the full server-storable schema:
  users, vaults, immutable vault snapshots, key envelopes (master / device / recovery),
  encrypted entries, devices, WebAuthn credentials, and the **Device-Key Envelope** mirror
  (`docs/webauthn-prf.md` §4).
- **Security Boundary v1** (below): account authentication and vault ownership, with the
  device routes behind it.
- Still follow-up work: WebAuthn ceremony endpoints, vault snapshot commit/CAS, and rotation.

## Security Boundary v1

### What a token means

An access token proves **one** thing: this request comes from account X. It is not a
capability. It contains no vault ids, no device ids, no scopes and no roles, so possession
of a token can never *be* an authorization — every request re-checks ownership against the
database. And no token, session or account secret can decrypt a vault: the Vault Key never
reaches this service (`docs/crypto-protocol.md`, Hard Invariant #5).

| Property | Choice | Why |
|---|---|---|
| Access token | JWT, EdDSA (Ed25519) or ES256, ~10 min | Asymmetric, so only this service needs the private half; short-lived, so a leaked token expires on its own |
| Claims | exactly `sub`, `iat`, `exp`, `jti`, `iss`, `aud` | Nothing else can be mistaken for a permission |
| Refresh token | opaque 256-bit random, Redis, rotating | Carries no claims; single-use with reuse detection |
| Account password | Argon2id (64 MiB, t=3, p=4) | Separate from the vault KDF in parameters and purpose |
| Logout | revokes the refresh family **and** deny-lists the access `jti` | Otherwise logout would be cosmetic for ~10 minutes |

### Endpoints

| Route | Auth | Notes |
|---|---|---|
| `POST /auth/register` | — | 201 with `{id, email}`; deliberately returns no tokens, so account creation is not implicitly a login |
| `POST /auth/login` | — | Returns an access + refresh pair. Unknown email and wrong password are indistinguishable, in both response and work performed |
| `POST /auth/refresh` | refresh token | Rotates: the presented token is consumed and a successor issued |
| `POST /auth/logout` | access token (+ refresh token in the body) | 204. Requires authentication so one account cannot log another one out |
| `GET /auth/me` | access token | Lets a client confirm a token is still live |
| `GET /vaults/{vault_id}/devices` | access token + **ownership** | Metadata only |
| `GET /vaults/{vault_id}/devices/{device_id}` | access token + **ownership** | Metadata only |

### Dependencies

| Dependency | Guarantees |
|---|---|
| `get_current_user` | A valid, non-revoked access token for an active account. Every failure mode — missing header, bad signature, expired, revoked by logout, unknown or deactivated account — returns the same 401 |
| `require_vault_owner(vault_id)` | The calling account owns the vault, and returns that vault. Check and load are one `WHERE id = … AND owner_user_id = …`, so a route cannot re-fetch with a weaker predicate |

### Two decisions worth knowing about

**A vault you do not own is a 404, not a 403.** A 403 would confirm that the id exists,
which is a membership oracle over other accounts' vaults. An unknown id and someone else's
id return byte-identical responses (`tests/test_device_authz.py`).

**Refresh-token reuse revokes the whole family.** A rotated token is kept as a tombstone
rather than deleted, so presenting it twice is *detected* rather than merely refused. Since
either the client replayed a token it should have dropped or somebody else holds a copy,
every token in that family is revoked and both parties must re-authenticate.

### Signing key

```sh
openssl genpkey -algorithm ed25519 -out jwt-signing-key.pem
# ES256 alternative:
openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt -out jwt-signing-key.pem
```

Set the PEM as `FOURALLPASS_JWT_PRIVATE_KEY`. In development it may be omitted, in which
case an ephemeral key is generated per process and logged as a warning. In production the
API **refuses to start** without one: an ephemeral key would invalidate every token on
restart and two instances would sign with different keys.

Losing this key means every account must log in again. It does **not** put any vault at
risk — see `docs/threat-model.md` §3, "Remote Attacker with Account Access".

### Relationship to the crypto protocol

This layer does not import `packages/crypto` and never will: everything the server
could compute with it would be over ciphertext it must treat as opaque, and having
the import available invites the "just decrypt it here" change this design forbids.
`tests/test_route_inventory.py` enforces that.

It also stays out of snapshot state entirely — no route touches `VaultSnapshot`,
`EncryptedEntry` or `KeyEnvelope`. Snapshot publication has requirements this
boundary does not implement (`docs/vault-revision.md` §4: write the full snapshot,
then compare-and-swap the active pointer; one snapshot per `(vault_id, revision)`),
so a half-built endpoint here would be worse than none. When those endpoints land,
they sit *behind* `require_vault_owner` and return the same opaque records a
malicious server already holds.

The `device_key_envelopes` mirror is queried for existence only — the route selects
`device_id` / `id` and reports a boolean. The stored `nonce`, `ciphertext` and `tag`
never enter a response, which is asserted in two ways: the schema's field list, and
a check that none of the stored bytes appear in any encoding (hex, base64, latin-1).

### Not in this step

Rate limiting / brute-force lockout on `/auth/login` (see `docs/threat-model.md`
§3.1), password change and reset flows, e-mail verification, OAuth sign-in (the
`users.oauth_*` columns exist but no flow uses them yet), disabling `/docs` and
`/openapi.json` in production, and anything vault- or sync-related.

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

The auth tests need Redis as well; they use database 15 (`FOURALLPASS_TEST_REDIS_URL`) and
flush it around each test, so they never touch a development database.

| File | Covers |
|---|---|
| `tests/test_auth.py` | registration, login, token shape, rotation, reuse detection, logout |
| `tests/test_device_authz.py` | 401 without a token, 404 for a vault you do not own, 200 for the owner, and that responses carry no key bytes |
| `tests/test_security_config.py` | signing-key configuration, including the production guard and rejection of foreign/unsigned tokens |
| `tests/test_route_inventory.py` | the API surface itself: the exact route list, that every vault-scoped route depends on `require_vault_owner`, that the token payload literal has exactly six claims, and that this layer does not import the crypto core or touch snapshot state |

`test_route_inventory.py` is there because per-route tests cannot catch a route
that is *added* later without protection. Its guards were verified by breaking
the rules on purpose: adding a `scope` claim and dropping the ownership
dependency each fail it.

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
