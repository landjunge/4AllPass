# Local loopback access broker

**Relay, not a token API.** The local process never decrypts the vault and never mints provider tokens. The approved secret is supplied by the unlocked UI.

`npm run app` / `python -m app.local` serves the relay on the **same origin**
(`http://127.0.0.1:8788/v1/access/request`). The process still never decrypts
and never mints provider tokens. Manual `npm run broker` runs `@4allpass/broker`
(Node, `:8787`) for a Vite-only session. That package is **not** the product
path and does not evaluate policy.

A foreign process (n8n HTTP Request, `@4allpass/access`, `examples/n8n-access-client.mjs`) can ask the unlocked app for a time-boxed credential without using `BroadcastChannel`.

```text
n8n  POST http://127.0.0.1:8788/v1/access/request
        Authorization: Bearer <pairing token>
   → local-access-broker (relay)
   → unlocked UI  Allow / Deny (overlay, or desktop prompt window)
   → JSON  approved | denied
```

## Run

```sh
npm run broker
# prints a pairing token
```

Access tab → paste token → Connect. Then:

```ts
import { fourAllPass, GitHub, redactGrant } from "@4allpass/access";

const client = fourAllPass({ application: "n8n" });
const result = await client.request({
  provider: GitHub.provider,
  capability: GitHub.repositoryRead,
  ttl: 15,
});
console.log(redactGrant(result));
```

```sh
FOURALLPASS_BROKER_TOKEN=… npm run access:demo
FOURALLPASS_BROKER_TOKEN=… npm run access:demo -- delete
FOURALLPASS_BROKER_TOKEN=… npm run access:demo -- unknown
```

## Rules (honest)

| Rule | How |
|---|---|
| Pairing token | Required on every call. Printed at start; not on the public API. |
| Bind | `127.0.0.1` only. |
| Browser grant path | `Origin: http(s)://…` on `POST /v1/access/request` is **403**. n8n/Node typically send no Origin. |
| PWA poll | CORS for the local app (`:8788`) and Vite (`:5173` / `:4173`). |
| Vault locked | No PWA poller → `denied` / `vault_locked`. No secret. |
| Policy | Still in the PWA (`decideAccess`). Unknown app = DENY. |
| Identity | Application name is still a **string**. The token is not OS identity. |
| Logs | Broker logs status, not `access_token`. |

`@4allpass/access` is that Node client: loopback URL only, no `Origin` header, pairing token required. It does not decrypt and does not talk to FastAPI. Using it from a web page will 403 on the grant path.

## n8n HTTP Request (no marketplace node)

Import [`examples/n8n-github-read.workflow.json`](../examples/n8n-github-read.workflow.json) into n8n (n8n Desktop / npm on the **same machine** as 4AllPass). Set env `FOURALLPASS_BROKER_TOKEN` to the pairing token. 4AllPass must be unlocked. Allow in the app. n8n-in-Docker still needs `host.docker.internal`.

The Access tab copies the same recipe. n8n: **HTTP Request** node, method POST, JSON body, header `Authorization: Bearer <pairing token>`. Do not add an `Origin` header (browser grant path is 403).

```http
POST http://127.0.0.1:8788/v1/access/request
```

```json
{
  "application": "n8n",
  "provider": "GitHub",
  "credential": "personal",
  "scope": ["repository.read"],
  "ttl": 600
}
```

The JSON never contains the pairing token or the GitHub secret. After Allow in 4AllPass, n8n receives `status: approved` and `access_token` (time-boxed). `repository.delete` is DENY unless that capability is on the entry.

**Docker:** n8n in a container cannot use `127.0.0.1` for the host. From the container use `host.docker.internal`; the broker still binds on the host. Do not expose the relay to the LAN.

This is not a marketplace n8n node. FastAPI still has no `/v1/access` route. See `docs/security-boundary.md` §7.
