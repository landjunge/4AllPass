# Launch posts (week 8)

Copy-paste. Do not strengthen the claims. Source article: [`your-ai-agent-doesnt-need-your-api-keys.md`](your-ai-agent-doesnt-need-your-api-keys.md). Demo: [`two-minute-demo.md`](two-minute-demo.md). Repo: https://github.com/landjunge/4AllPass.

**Click target:** use the repo (or the GitHub Pages product front) until a 4AllPass section exists on https://netzwerkpunkt.de. Then switch posts to the hub. Do not claim the hub already lists 4AllPass.

Visibility: [`discoverability.md`](discoverability.md). Cards: [`../site/produkte.json`](../site/produkte.json).

**Not posted automatically.** FastAPI still does not mint tokens. There is no n8n marketplace node.

---

## 1 — X / agents (first)

Your agents need access. They don't need your secrets.

n8n asks GitHub `repository.read` → you Allow → time-boxed handoff. `repository.delete` is DENY. Unknown app is DENY. The long-lived PAT never sits in the workflow.

Local broker, unlocked device. The server is a blob store.

https://github.com/landjunge/4AllPass/blob/main/docs/your-ai-agent-doesnt-need-your-api-keys.md

### Thread (2/3)

This is not “a nicer Bitwarden” and not HashiCorp-for-home.

Detect ≠ Allow. Expiry stops *future* handoffs — a copy already given is not un-known. Rotate the upstream secret to revoke a leak.

### Thread (3/3)

Two minutes, Access tab (or headed Chrome: `two-minute-demo.spec.ts`).

MCP is a client, not the security boundary. Tollgate (later) is “may I act?” 4AllPass is “may I access?”

---

## 2 — n8n community

Title: **Credential access without parking the PAT in the workflow**

I keep pasting GitHub / OpenAI keys into n8n credentials. That is a long-lived secret in the automation host.

I am building 4AllPass around the opposite: n8n asks for GitHub `repository.read` for a few seconds, I click Allow, the handoff expires. Delete-scope and unknown apps are denied. The API server never sees the token.

There is **no** n8n node yet. The tryable piece is a local Access tab + same-origin `POST /v1/access/request` over BroadcastChannel. Walkthrough: https://github.com/landjunge/4AllPass/blob/main/docs/two-minute-demo.md

If a native n8n credential type is useful, say so — that is the next client, not a FastAPI token mint.

---

## 3 — MCP / agent tools

MCP is how an agent *calls* tools. It is not how you decide whether that agent may hold a secret.

4AllPass is the allow/deny + TTL step **before** anything like MCP gets bytes. Unknown application = DENY. The vault server does not speak MCP and does not mint tokens.

Article: https://github.com/landjunge/4AllPass/blob/main/docs/your-ai-agent-doesnt-need-your-api-keys.md

---

## 4 — Security / DevOps (second)

Self-hosted ZK vault. Server stores envelopes only. New wedge is *agent credential access* on the unlocked device: scoped, TTL, explicit Allow, audit without secrets.

Honest limits in the article (string app identity, no remote revoke of a copy already given, no FastAPI `/v1/access`). Spec: `docs/security-boundary.md`.

---

## 5 — Deutsch (X)

Deine Agenten brauchen Zugang. Nicht deine Secrets.

n8n fragt GitHub `repository.read` → Allow → zeitlich begrenzter Handoff. Delete und unbekannte Apps: DENY. Der Server sieht den Token nicht.

https://github.com/landjunge/4AllPass
Suite (in Arbeit): https://netzwerkpunkt.de
