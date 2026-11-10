# E03 / P03 — account, session and web API

Base: `764d81911134fdd23cece0c1d5e5591eaa8ca639` (after P02, #264). Environment as
in `../e03-p00-p01-20261110/STATUS.md`. Plan source and status: ThreadDesk.

## Read

`api/deps.py` (bearer + `X-Device-Id` binding, ownership → 404), `routes/auth.py`
(local bootstrap, register, login with dummy Argon2id, logout), `core/sessions.py`
(memory/Redis store, HMAC lookup key, per-device revoke), `api/rate_limit.py`,
all routers (`vaults`, `devices`, `webauthn`, `local_meta`, `broker`), and the
server deployment (`deploy/compose.yml`, `deploy/nginx-vault.conf`).

## Finding fixed (reproduced, test fails when the fix is reverted)

| ID | Prio | Precondition → effect | Fix | Test |
|---|---|---|---|---|
| E03-P03-1 | B | Shipped server deployment. nginx sent only `X-Real-IP` (ignored by uvicorn) and uvicorn trusted forwarded headers only from 127.0.0.1, while requests arrive from the Docker gateway. All callers shared one rate-limit bucket: 10 anonymous logins/min locked every account out of login and registration; one account's 30 writes/min throttled every other account's commits. | nginx `/api/` overwrites `X-Forwarded-For $remote_addr`; backend runs `--proxy-headers --forwarded-allow-ips '*'` (port bound to loopback, host nginx is the only peer) | `backend/tests/test_deploy_proxy.py` (built from the two deployed files) |

A running server only gets this after its deployment is updated; nothing was
deployed from here.

## Coverage added

`test_authorization_idor.py` now also sends account B against `/revisions`,
`/revisions/{n}`, WebAuthn challenge issue and consume: all 404, as specified.

## Checked, no fault

Foreign ids 404 on every vault-scoped route; invalid, expired and logged-out
tokens 401; session bound to the device id from login; inactive account with a
live token 401; `/auth/local` absent on the server profile; login spends one
Argon2id verification for unknown accounts; no logging of tokens, emails or
bodies in `backend/app`. Body-limit stream stall was closed in E02 (AP-02, #230).

## Remaining boundaries (unchanged)

- A stolen bearer token **together with** its device id keeps full storage
  write power until expiry or revoke (device id is client-asserted, not proof
  of possession); documented in `security-boundary.md`. B.
- `POST /auth/register` answers 409 for a known e-mail (registration
  enumeration; login stays uniform). C.
- `frontend/nginx.conf` (container `web`) still forwards only `X-Real-IP`; it is
  not on the `/api/` path of the shipped deployment. C.

## Test runs

| Command | Result |
|---|---|
| backend `pytest`, throwaway SQLite | 229 pass, 1 skip (PostgreSQL migration test) |
| `test_deploy_proxy.py` against the unfixed deploy files | fails: second client gets 429 |
