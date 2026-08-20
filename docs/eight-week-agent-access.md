# 8-week plan — Agent credential access

**Status:** Working plan (2026-08-21). Tracker: [#76](https://github.com/landjunge/4AllPass/issues/76). 4AllPass stays **its own product**. Tollgate is a later client, not a dependency.  
**Wedge:** Credential access for AI agents.  
**Line:** *Your agents need access. They don't need your secrets.*  
**Not this document:** merging with Tollgate, FastAPI returning plaintext tokens, auto-approve, 50 providers, “a nicer Bitwarden.”

Companion: `secret-access-layer.md`, `provider-service-vision.md`, `capability-contract-v1.md` (4AP-CAP-1), `security-boundary.md`.

**Today (honest):** the PWA is a device-centric ZK **vault**. This plan is how a stranger can try the *wedge* in eight weeks. Do not put week-8 claims on the README until the demo exists.

---

## End of week 8

A stranger can understand and **try**:

> I can give my agent access to Stripe / GitHub / AWS / n8n / FTP / mail without leaving it the long-lived secret.

Crypto stays v1: envelopes, Vault Key, CAS, FastAPI is a blob store. The **broker is local**. `POST /v1/access/request` in this plan is **not** the public FastAPI process.

---

## Zero-Knowledge (non-negotiable)

| Rule | Why |
|---|---|
| FastAPI never sees the secret, the scoped token, or “n8n asked for GitHub” as searchable columns | Metadata is infrastructure |
| Broker is device-local, after unlock | Same as `secret-access-layer.md` |
| Unknown application = **DENY** | Process name is not identity |
| Auto-detect ≠ auto-approve | Guess the provider; never grant |
| Expiry stops *future* handoffs; a copy already given is not un-known | Rotate the upstream secret to revoke a leak |
| Tollgate talks to 4AllPass **last** | 4AllPass does not depend on Tollgate |

---

## Weeks

### 1 — Positioning

Core message (not “password manager”, not “secret manager”):

> **4AllPass — Secure credential access for humans, applications and AI agents.**  
> **Your agents need access. They don't need your secrets.**

README shows the access loop first, crypto later. Architecture:

```text
Human / App / Agent → request → Policy → approval/deny → scoped credential → Provider
```

Shipped this week: **docs + README wedge**. Not the broker.

### 1–2 — MVP providers (three classes only)

Not the full template list. Demo needs:

| Class | Why |
|---|---|
| **API** | GitHub / Stripe / OpenAI-style key |
| **SSH/SFTP** | Not “just API keys” |
| **Web/HTTP** | Generic login |

Full list (Website, Mail, Domain, Hosting, Cloud, Git, DB, VPN, Custom) stays in `provider-service-vision.md`.

### 2 — Killer use case: n8n

```text
n8n → “I need GitHub” → 4AllPass (app, provider, account, scope, TTL, approval)
     → temporary credential → n8n → 10 min → EXPIRED
```

That is the demo. Not a crypto lecture.

### 3 — Auto-discovery

Paste credential / host → detect provider + type + fields. **Never unlock from a guess.**

### 3–4 — Provider ≠ Account ≠ Credential

Templates (YAML-shaped, in ciphertext). Custom providers allowed. Not hardcoded into `packages/crypto`.

### 4 — Application identity

Who is asking. Unknown → DENY.

### 5 — Access API (local)

```http
POST /v1/access/request
```

JSON: `application`, `provider`, `credential`, `scope`, `ttl`.  
Response: `approved` + time-boxed material **or** `denied`.

Host: **local broker**, same envelopes. Clients later: n8n, Gnom-Hub-V1, agents, Tollgate.

### 5 — Approval UI

“n8n requests GitHub `repository.read` for 10 minutes.” Allow / Deny. High-risk scopes marked.

### 6 — Audit

Every decision in ciphertext on the device: who, app, provider, scope, TTL, APPROVED/DENIED, expiry. No secret in logs or error strings.

### 6 — Security proof

Tests: unknown app DENY, bad scope DENY, expired DENY, unknown provider DENY, tamper DENY, revoked DENY, secret never in logs.

### 7 — Two-minute demo

Allow n8n GitHub read → works → `repository.delete` DENY → TTL expire → unknown app DENY.

### 8 — Launch

Article: *Your AI Agent Doesn't Need Your API Keys.* Then posts and communities (agents, n8n, MCP first; security/DevOps second). **Promote only after the demo exists.**

Tollgate **after** week 8:

```text
4AllPass  “May I access?”
Tollgate  “May I act?”
```

---

## Do not

- “Better Bitwarden”
- 50 providers before anyone uses it
- Lead with cryptography
- Merge Tollgate and 4AllPass
- Let agents hit the vault DB
- Hand out long-lived API keys
- Auto-unlock from discovery

---

## Order (locked)

**MVP → agent credential access → policy → scoped/TTL → provider system → auto-detection → n8n → audit → demo → community.**  
Then promote. Then a small interface to Tollgate.
