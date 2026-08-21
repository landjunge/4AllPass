# Your AI Agent Doesn't Need Your API Keys

**4AllPass** — secure credential access for humans, applications and AI agents.  
Line: *Your agents need access. They don't need your secrets.*

This is the week-8 launch note for [`eight-week-agent-access.md`](eight-week-agent-access.md). It is not a cryptography lecture. Try the loop first: [`two-minute-demo.md`](two-minute-demo.md).

---

You pasted a GitHub PAT into n8n. Then into a second workflow “just for the weekend.” Then into an agent’s env file. Three processes now hold a long-lived secret. Rotating it means hunting copies.

That is the default. It is also the wrong default.

```text
Human / App / Agent → request → Policy → allow / deny → scoped credential → Provider
```

The agent asked for **GitHub read for a few seconds**. It did not need the PAT forever. 4AllPass is the place that question is answered — on the unlocked device, by you.

---

## What you can try today

Unlock a vault. Open the **Access** tab.

1. n8n asks GitHub `repository.read` → **Allow** → a time-boxed handoff (token redacted, countdown).
2. n8n asks `repository.delete` → **DENY**. Scope is not “GitHub, whatever.”
3. The grant expires. Future handoffs stop.
4. An unknown app asks GitHub → **DENY**.

Same origin, optional: `/agent-request.html` speaks `POST /v1/access/request` over `BroadcastChannel` `4allpass-access-v1`. The FastAPI process is not on this path. It never sees the request, the secret, or “n8n asked for GitHub.”

Headed Chrome (real mouse): `frontend/e2e/live/two-minute-demo.spec.ts`.

---

## What this is not

| Claim you might expect | Reality |
|---|---|
| Production n8n credential type | Not shipped. The Access tab is the killer story, not a marketplace node. |
| FastAPI mints tokens | Never. The server stores opaque envelopes. Grants live in the unlocked page. |
| MCP is the security boundary | No. MCP is a later *client*. Unknown application = DENY. |
| Auto-detect unlocks the vault | Detect prefills Web / API / SFTP. It does not call Allow. |
| Expiry un-knows a leak | It stops *future* handoffs. A copy already given is not un-known. Rotate the upstream secret. |
| “n8n” is OS identity | Today it is a string. Anyone who can post on the channel can claim that name. Binding to a signed process is later. |
| A nicer Bitwarden | That is not the wedge. |
| Merged with Tollgate | 4AllPass answers “May I **access**?” Tollgate, later, answers “May I **act**?” Do not merge them. |

---

## Why the long-lived key stays put

The vault is still a device-centric Zero-Knowledge store: random Vault Key, envelopes, CAS. Account password ≠ vault password. The server cannot decrypt entries and is not asked to mint a GitHub token. The broker runs **after unlock**, on the device that already has plaintext.

That is the product, not a footnote. Crypto details: [`security-boundary.md`](security-boundary.md).

---

## Who this is for

People who already run n8n, agents, or MCP tools and are tired of parking `ghp_` / `sk-` / `sk_live_` in workflow JSON. Self-hosters who want the server to stay a blob store. Not a team SSO pitch. Not fifty providers before anyone uses one.

Repo: [landjunge/4AllPass](https://github.com/landjunge/4AllPass).

---

## After this note

Posts and community threads belong in [`launch-posts.md`](launch-posts.md) (agents / n8n / MCP first; security and DevOps second). Do not paste week-8 slogans that the Access tab cannot demonstrate.

Tollgate talks to 4AllPass **last**:

```text
4AllPass  “May I access?”
Tollgate  “May I act?”
```
