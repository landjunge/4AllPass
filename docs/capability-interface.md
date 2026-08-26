# Capability interface (4AllPass × Tollgate × Gnom-Hub)

**Status:** Concept only. Far later. Protocol v1 is unchanged.  
**Date:** 2026-08-20  
**Not this document:** a merge of the three repos, a FastAPI grant API, Tollgate-in-4AllPass, 4AllPass-as-policy-engine, or an orchestrator.

Companion: `capability-contract-v1.md` (**4AP-CAP-1** — the small contract, not a new protocol), `secret-access-layer.md` (egress), `provider-service-vision.md` (vault shape), `positioning-target.md` (category).  
Tracker: [#70](https://github.com/landjunge/4AllPass/issues/70). Related: [#67](https://github.com/landjunge/4AllPass/issues/67), [#65](https://github.com/landjunge/4AllPass/issues/65).

Sibling products (separate codebases, keep them that way):

- [tollgate](https://github.com/landjunge/tollgate) — Protect · Route · Prove; budgets, scopes, tool-loop stops. Today it can hold provider keys on disk (`docs/KEYS_MODULE.md` there). That is **not** the long-term secret authority.
- [gnom-hub-v1](https://github.com/landjunge/gnom-hub-v1) — local multi-agent desk. First-class **client**, not a vault.

If this sketch is quoted as an Ist-Zustand of 4AllPass, that is a **defect**.

---

## 1. One job each

```text
Gnom-Hub     = Orchestration     (which agent runs)
4AllPass     = Secret Authority  (who may receive which secret)
Tollgate     = Execution Authority (what that principal may do with it)
```

Do **not** merge the products. Do **not** invent a proprietary super-protocol. The join is the **Capability contract** (`capability-contract-v1.md`): Issue / Verify / Inspect / Revoke.

> 4AllPass knows no Tollgate policies. Tollgate knows no vault contents. Gnom-Hub knows no secrets.

> Identity is shared (later: [`specs/maip-v0.1.md`](specs/maip-v0.1.md)). Authorization stays local.

| Product | Question it answers | Must not start doing |
|---|---|---|
| **MAIP** (later) | Who is this agent, cryptographically? | Tool rights, spend, secrets |
| **4AllPass** | Which secrets may this **verified** identity use? | Agent orchestration; spend/budget; model allow-lists; “run this workflow” |
| **Tollgate** | What may you do with that access, right now? | Store the personal vault; become a password manager; invent Vault Keys |
| **Gnom-Hub** | Which agent is working on which task? | Hold production API keys; admit spend; unwrap VK |
| **MCP / tools** | Which tools may this identity call? | Become the security boundary |

```text
                    ┌─────────────────────┐
                    │ MAIP (later)         │
                    │ Who is the agent?    │
                    └──────────┬──────────┘
                               │ verified identity
        ┌──────────────┬───────┴────────┬──────────────┐
        ▼              ▼                ▼              ▼
    4AllPass        Tollgate         Gnom-Hub        MCP
    secrets         execution        runtime         tools
```

Words to keep using:

- **4AllPass = Secret Authority**
- **Tollgate = Execution Authority**

---

## 2. What a Capability is

Not “API key.” A Capability is a **bounded grant**. **Capability ≠ Secret.** Claims live in 4AP-CAP-1; secret bytes never do.

```text
id:          cap_123
principal:   gnom-agent-7 | n8n | claude-code
provider:    openai
credential:  production          # reference, not the secret bytes
scope:       chat
ttl:         15 min              # secret-side expiry (4AllPass)
```

Tollgate **attaches** execution policy (its job today):

```text
models:      …
budget:      €2
requests:    50
tools:       …
time limit:  (may be shorter than secret TTL)
```

Split the blob on purpose. Budget/models/tools are **not** 4AllPass fields. Credential/secret/TTL-of-the-secret are **not** Tollgate fields. The shared handle is `capability_id` + principal + provider + credential *ref* + overlapping TTL.

4AllPass answers:

> Is this capability legitimate, and which secret sits behind it?

Tollgate answers:

> May this capability perform **this** action **now**?

```text
4AllPass  →  “here is a credential / capability”
Tollgate  →  “you may use it only under these conditions”
Provider
```

Ideal: the agent never holds a **permanent** provider key. After TTL: capability expired. Same honest limit as `secret-access-layer.md` §2.1: expiry stops *future* unwraps; it does not erase a copy an agent already made. Rotate the upstream key to revoke a leak.

---

## 3. Example: agent start

```text
Agent: Research-Agent
Needs: Web Search, OpenAI, GitHub Read
```

Gnom-Hub asks 4AllPass which credentials this principal may get → OpenAI Research ✓, GitHub Read ✓, GitHub Write ✗, AWS Production ✗.

Tollgate then admits the actual calls: OpenAI €1 / 50 calls, GitHub read-only / 100 requests, Web allowed.

n8n path is the same two gates: 4AllPass Allow (application + credential + TTL), then n8n → Tollgate → OpenAI for budget/rate/model/tool/time.

Human path (browser fill) does **not** go through Tollgate. Plane 1 stays 4AllPass → website.

---

## 4. Interface rules (when this is ever built)

1. **Keep three repos.** A shared schema/doc is allowed. A monorepo “AI security suite” is not this plan.
2. **Tollgate is a Trusted Application** of the Secret Access Layer (`secret-access-layer.md` Phase D), default DENY like any other process.
3. **Prefer a signed capability, not `export OPENAI_API_KEY`.** 4AllPass must not *have* to trust Tollgate with the permanent secret. How the provider gets bytes is **A/B/C** in `capability-contract-v1.md` §5 — pick later; prefer short-lived upstream credentials (C). Do not copy the vault into `keys_app.json`.
4. **MCP is not the security interface.** It stays the tool protocol above this contract.
5. **4AllPass FastAPI never sees capabilities.** Grants stay on the device, in ciphertext after unlock — same as SAL.
6. **4AllPass does not enforce Tollgate policy.** No spend ledgers, no model lists, no tool-loop counters in `packages/crypto` or the PWA.
7. **Tollgate does not unwrap Vault Keys.** If it needs bytes, it gets them through the local broker after approval, like n8n — and only after Verify of a cap.
8. **Gnom-Hub does not become a second broker.**

---

## 5. Triggers to reopen this file

- Secret Access Layer (`#67`) is in implementation **and** someone is ready to make Tollgate a Trusted Application instead of a disk key store.
- Explicit request for **4AP-CAP-1** / the Capability contract (not “weiter”, not “merge Tollgate”, not “put budgets in 4AllPass”, not “MCP as security”).

Until then: **4AllPass is a password manager; Tollgate is a separate safety layer that still holds its own keys; there is no shared capability object in this repository.**

No code here implements the interface.
