# `@4allpass/access`

**DE.** Kleines Node-SDK für Agenten: `fourAllPass.request({ provider, capability, ttl })`. Spricht mit dem lokalen Relay auf `127.0.0.1`, nicht mit FastAPI. FastAPI minted keine Tokens. Das ist kein n8n-Marketplace-Node.

**EN.** Tiny Node SDK for agents: `fourAllPass.request({ provider, capability, ttl })`. Talks to the local loopback relay, not FastAPI. FastAPI never mints tokens. This is not an n8n marketplace node.

```ts
import { fourAllPass, GitHub, redactGrant } from "@4allpass/access";

const client = fourAllPass({
  token: process.env.FOURALLPASS_BROKER_TOKEN,
  application: "n8n",
});

const result = await client.request({
  provider: GitHub.provider,
  capability: GitHub.repositoryRead,
  ttl: 15,
});

console.log(redactGrant(result));
```

Pairing token: `FOURALLPASS_BROKER_TOKEN` (data dir `broker.token` or Access tab). Vault password and Vault Key never go here. Data dir: macOS `~/Library/Application Support/4AllPass/`, Windows `%APPDATA%\4AllPass\`, Linux `~/.local/share/4allpass/`.

| Rule | What this package does |
|---|---|
| Loopback only | URL must be `127.0.0.1` / `localhost`. Remote hosts throw. |
| No `Origin` | Browser grant path is 403. Use this from Node / n8n Code, not a web page. |
| No decrypt | Policy and plaintext stay in the unlocked app. |
| Unknown app | Still sent; the vault DENYs. The SDK does not invent trust. |
| Logs | `redactGrant` / `redactSecrets`. Do not print `accessToken`. |

GitHub capabilities here match the vault template (`repository.read` / `write`, `issue.read`) plus high-risk `repository.delete`. Not the full GitHub REST scope list.
