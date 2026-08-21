# Local loopback access broker

**Not FastAPI.** Default **off**. The sidecar never decrypts the vault and never mints tokens.

A foreign process (n8n HTTP Request, `examples/n8n-access-client.mjs`) can ask the unlocked PWA for a time-boxed credential without using `BroadcastChannel` (same-origin only).

```text
n8n  POST http://127.0.0.1:8787/v1/access/request
        Authorization: Bearer <pairing token>
   → local-access-broker (relay)
   → unlocked PWA  Allow / Deny
   → JSON  approved | denied
```

## Run

```sh
npm run broker
# prints a pairing token
```

Access tab → paste token → Connect. Then:

```sh
FOURALLPASS_BROKER_TOKEN=… node examples/n8n-access-client.mjs
FOURALLPASS_BROKER_TOKEN=… node examples/n8n-access-client.mjs delete
FOURALLPASS_BROKER_TOKEN=… node examples/n8n-access-client.mjs unknown
```

## Rules (honest)

| Rule | How |
|---|---|
| Pairing token | Required on every call. Printed at start; not on the public API. |
| Bind | `127.0.0.1` only. |
| Browser grant path | `Origin: http(s)://…` on `POST /v1/access/request` is **403**. n8n/Node typically send no Origin. |
| PWA poll | CORS only for `127.0.0.1:5173` / `localhost:5173` (and preview `:4173`). |
| Vault locked | No PWA poller → `denied` / `vault_locked`. No secret. |
| Policy | Still in the PWA (`decideAccess`). Unknown app = DENY. |
| Identity | Application name is still a **string**. The token is not OS identity. |
| Logs | Broker logs status, not `access_token`. |

This is not a marketplace n8n node. FastAPI still has no `/v1/access` route. See `docs/security-boundary.md` §7.
