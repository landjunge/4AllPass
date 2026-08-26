# Agent access (4AllPass)

**Status:** Architecture for later. **Not implemented** beyond today’s string + pairing token + human Allow.  
**Date:** 2026-08-26

> Agents receive capabilities, not vault access.

Companion: [`agent-identity.md`](agent-identity.md), [`../specs/maip-v0.1.md`](../specs/maip-v0.1.md), [`../secret-access-layer.md`](../secret-access-layer.md) (egress module), [`../local-access-broker.md`](../local-access-broker.md) (what runs), [`../security-boundary.md`](../security-boundary.md) §7.

MAIP does not change vault envelopes. Identity is a gate **in front of** credential policy.

---

## Target flow (not built)

```text
Agent
  → Identity verification (MAIP)
  → Verified AgentIdentity
  → 4AllPass policy
  → Capability check
  → Human approval / standing rule
  → Credential use / proxy
```

Unknown, unverified, or revoked → **DENY**.

No fallback to: localhost, application name, process name, “it came from Gnom-Hub.”

---

## No full vault for agents

Forbidden: `vault.read_all`.

Scoped examples: `credential.use`, `github.repository.read`, `invoice.read`.

### Access classes

| Class | Meaning |
|---|---|
| **Human only** | Never an agent. Recovery Key; extra-sensitive items the owner marks. |
| **Mediated** | Preferred. 4AllPass or a local proxy uses the secret; the agent does not hold it. |
| **Raw secret handoff** | Only when a protocol cannot work otherwise (today’s n8n PAT path). |

A TTL expires **later 4AllPass handoffs**. It does not rotate a GitHub PAT already copied. Documented in [`../security-boundary.md`](../security-boundary.md) §7. Grants on `main` already set `handoff: "raw_secret"`.

Mediated access is [`../secret-access-layer.md`](../secret-access-layer.md) — still far later, default off, FastAPI is not the broker.

---

## Enrollment (later)

1. Agent creates Ed25519 keypair. Private key stays on the agent.
2. Public key offered for registration.
3. Human confirms.
4. Registry stores the MAIP document.
5. Each agent is independently revocable.

Each request: `agent_id`, `timestamp`, `nonce`, `action`, `resource`, signature. Verify MAIP **then** 4AllPass policy.

---

## Today

Loopback broker, Origin 403, pairing token, `TRUSTED_APPLICATIONS = ["n8n"]`, unknown DENY, human Allow. Pairing token ≠ agent identity. Do not replace that demo with MCP-as-security.
