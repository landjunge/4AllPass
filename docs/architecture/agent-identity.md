# Agent identity (shared core, local authorization)

**Status:** Architecture. MAIP v0.1 is an experimental draft. **Not implemented.**  
**Date:** 2026-08-26

> Identity is global and shared. Authorization stays local to each system.

> Small core, strict guarantees, optional extensions.

> No verified cryptographic agent identity → no agent access.

Companion: [`../specs/maip-v0.1.md`](../specs/maip-v0.1.md), [ADR-008](adr/ADR-008-agent-identity.md), [`../capability-interface.md`](../capability-interface.md) (who may *do* what), [`../secret-access-layer.md`](../secret-access-layer.md) (who may *use* a secret), [`agent-access.md`](agent-access.md) (4AllPass flow).

Do not start a fifth repo. If a package ever exists, it is identity only (document, verify, enrol, revoke, nonce). Not billing, not tools, not vault crypto.

---

## One identity, four decisions

```text
Agent Identity Core (MAIP)
        │
        ├── Gnom-Hub     create / run / delegate agents
        ├── Tollgate     actions, cost, tool-loop limits
        ├── 4AllPass     credential use
        └── MCP / Tools  tool and resource permissions
```

Example: `maip:ed25519:…` issued by `gnom-hub-v1`, status active.

- Tollgate: this subject may spend at most 2 € / hour.
- 4AllPass: this subject may use GitHub only as `repository.read`.
- MCP: this subject may `filesystem.read` and `github.issue.write`.

Gnom-Hub must not decide which secrets 4AllPass releases. 4AllPass must not decide Tollgate budgets. MCP must not become the security boundary ([`../capability-contract-v1.md`](../capability-contract-v1.md)).

---

## Identity ≠ authorization

A verified identity means: **we know which agent this is.**  
It does **not** mean: this agent may do anything.

```ts
interface AgentIdentity {
  subject: string; // maip:ed25519:…
  type: "local-key" | "spiffe" | "oauth";
  issuer: string;
  publicKeyThumbprint?: string;
  principal?: string;
  parent?: string;
  deviceId?: string;
  verified: boolean;
}
```

`type` other than `local-key` is an extension. `verified: false` or missing crypto → **DENY** in 4AllPass.

Display names (`Coder Agent`, `application: "n8n"`) are labels. They are never the security identifier.

---

## Today vs later

| | Today (running) | Later (MAIP) |
|---|---|---|
| Identifier | String `n8n` | `maip:ed25519:<thumbprint>` |
| Proof | Pairing token (process secret) | Ed25519 over JCS request |
| Policy | `@4allpass/core` Allow/Deny + TTL | Same engine; principal is verified first |
| FastAPI | No agent keys, no vault unwrap | Same |

Do not implement MAIP in this sequence. Autofill v3 and Vault Protocol docs stay first.
