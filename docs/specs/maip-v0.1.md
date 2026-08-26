# MAIP v0.1 — Minimal Agent Identity Profile

**Status:** Experimental draft. **Not implemented. Not a network protocol in this repo.**  
**Date:** 2026-08-26  
**Motto:** Identity, not authority.  
**Design:** Small core, strict guarantees, optional extensions.

MAIP answers only: who is the agent, can they prove it, who issued the identity, is it active or revoked, and is *this request* signed.

MAIP does **not** define tool rights, credential rights, billing, trust scores, orchestration, or global capabilities. Those stay in Gnom-Hub, Tollgate, 4AllPass, and MCP.

Not a replacement for OAuth, OIDC, SPIFFE, MCP, or IAM. Adapters later (`maip-ext-spiffe`, `maip-ext-oauth`). Not W3C VC / EUDI — those remain the public-identity path if we ever need them ([`../architecture/future-architecture.md`](../architecture/future-architecture.md)).

Does **not** change `packages/crypto`, envelopes, or Vault Protocol v1.

Companion: [`../architecture/agent-identity.md`](../architecture/agent-identity.md), [ADR-008](../architecture/adr/ADR-008-agent-identity.md), [`../capability-interface.md`](../capability-interface.md).

---

## Rules

1. No cryptographic identity → no trusted agent identity.
2. Identity never implies authorization.
3. Display names are never security identifiers.
4. Every agent identity must be independently revocable.
5. MAIP must work without central infrastructure.
6. The core stays small. New features belong in extensions.

---

## Core (mandatory)

Ed25519, SHA-256, RFC 8785 JCS, identity document, signed request, timestamp, nonce, enrollment, local registry, revocation.

**Agent ID**

```text
maip:ed25519:<sha256-of-canonical-public-key>
```

Display name is a separate field. Never the id.

**Identity document**

```json
{
  "maip_version": "0.1",
  "id": "maip:ed25519:…",
  "public_key": "<raw 32-byte Ed25519 public key, base64url>",
  "issuer": "gnom-hub-v1",
  "created_at": "2026-08-26T00:00:00Z"
}
```

Optional: `display_name`, `principal`, `parent`, `device_id`. Optional fields are not authorization.

**Signed request** (body; signature is detached over JCS UTF-8 bytes)

```json
{
  "maip_version": "0.1",
  "agent_id": "maip:ed25519:…",
  "timestamp": 1787728000,
  "nonce": "<128-bit random, base64url>",
  "action": "credential.use",
  "resource": "github"
}
```

```text
JCS(request without signature) → UTF-8 → Ed25519.sign(agent_sk)
```

Replay: accept timestamp only inside a small window; each nonce once per verifier.

**Enrollment:** agent generates Ed25519 keypair; private key stays with the agent; public key offered; a human confirms; registry stores the document. Revoke = mark `id` revoked. No silent re-enrol under the same id.

**Verify, in order:** known? active? public key matches `id`? signature valid? timestamp ok? nonce unseen? **Then** the local system applies **its** policy (4AllPass secrets, Tollgate limits, MCP tools). MAIP never answers “allow.”

**Registry** is local to the verifier (or a file the operator controls). No required cloud directory. FastAPI must not mint agent keys or vault unwrap.

**Test vectors:** none in this draft. The first library that implements verify must publish KATs (known document, request, signature, pass/fail). Do not invent unsigned examples that look like KATs.

---

## Extensions (not v0.1)

| Extension | Later |
|---|---|
| `maip-ext-delegation` | Parent → child; delegated permissions ≤ parent. Never widens. |
| `maip-ext-spiffe` | Adapter, not a fork |
| `maip-ext-oauth` | Adapter, not a fork |
| `maip-ext-device-binding` | Bind agent key to a host device |

Delegation example (Gnom-Hub): User → Hub → Planner → Coder. Still optional.

---

## v1 4AllPass today

`application: "n8n"` + pairing token + human Allow. Spoofable. Documented in [`../security-boundary.md`](../security-boundary.md) §7. MAIP replaces that **string as identity**, not the Allow/Deny policy engine.
