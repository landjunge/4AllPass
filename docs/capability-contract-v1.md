# 4AP-CAP-1 — Capability contract

**Status:** Concept only. Far later. **Not a network protocol. Not implemented.**  
**Date:** 2026-08-20  
**Not this document:** OAuth-as-vault, MCP-as-security, a 4AllPass/Tollgate/Gnom-Hub SDK, public-key wrapping of the Vault Key, or Ed25519 in `packages/crypto`.

Companion: `capability-interface.md` (who does what), `secret-access-layer.md`, `post-quantum-roadmap.md` (v1 wrapping is still symmetric).  
Tracker: [#70](https://github.com/landjunge/4AllPass/issues/70).

**Architecture rule (non-negotiable):**

> 4AllPass knows no Tollgate policies. Tollgate knows no vault contents. Gnom-Hub knows no secrets.

**Capability ≠ Secret.** A capability is permission to *use* Secret X for purpose Y. The secret bytes stay in 4AllPass.

---

## 1. What this is

A **small shared contract** between 4AllPass (issuer) and Tollgate (verifier/enforcer). Document first, code later.

Not:

```text
4AllPass ↔ Tollgate
   ↕
proprietäres Superprotokoll
```

Yes:

```text
4AllPass  --Capability Contract-->  Tollgate
```

Reuse existing standards **where they actually fit**. Do not invent a fourth auth platform.

| Need | Reuse | Do not |
|---|---|---|
| Delegating *human/app identity* | OAuth 2.0 / OIDC, if we ever need that | Turn 4AllPass into an IdP for the vault |
| Secret *shape* | Existing credential types (bearer token, API key ref) | A new secret encoding for the sake of it |
| Agent *tools* | MCP (Gnom-Hub already speaks it) | Treat MCP as the security boundary |

MCP stays the tool/resource protocol. This contract is the **security authority boundary**.

```text
                MCP
                 │
          Agent / Gnom-Hub
                 │
          Capability Contract   ← this file
             /          \
        4AllPass         Tollgate
        Secrets          Policy
```

---

## 2. Operations (and nothing else)

No mega-SDK. Four verbs:

| Verb | Who | Meaning |
|---|---|---|
| **Issue** | 4AllPass | Principal P may use credential-ref C until `expires_at` |
| **Verify** | Tollgate (local) | Signature, expiry, audience, nonce — **without** the vault |
| **Inspect** | Either, after verify | Read claims. Still no secret bytes |
| **Revoke** | 4AllPass | This `capability_id` is dead before expiry |

That is the whole first surface.

---

## 3. Object (claims, not the secret)

Sketch — field names can move; the split must not:

```json
{
  "v": "4AP-CAP-1",
  "capability_id": "cap_123",
  "principal": "gnom-agent-7",
  "provider": "openai",
  "credential": "production",
  "scope": ["chat"],
  "aud": "tollgate-local",
  "iat": "2026-08-20T20:00:00Z",
  "expires_at": "2026-08-20T20:15:00Z",
  "nonce": "…",
  "constraints": {
    "note": "optional issuer-side caps set at Issue, not Tollgate policy"
  }
}
```

plus a **signature over the claims**.

| Field | Owner | Notes |
|---|---|---|
| `capability_id`, `principal`, `provider`, `credential` | 4AllPass | `credential` is a **ref**, never `sk-…` |
| `scope`, `aud`, `iat`, `expires_at`, `nonce`, `v` | 4AllPass | Audience is the local Tollgate (or broker), not the internet |
| `constraints` | optional 4AllPass | User-set issuer bounds at Issue (e.g. “chat only”). **Not** Tollgate’s budget engine |
| spend / models / tools / rate | **Tollgate only** | Evaluated after Verify. 4AllPass must not import this ledger |

4AllPass says: this capability exists and is valid for this principal.  
Tollgate says: under *my* policy, this action is allowed **now**.

Both must pass. Tollgate can be stricter than `expires_at` / `scope`. Tollgate cannot widen them.

---

## 4. Trust: 4AllPass must not have to trust Tollgate

Bad:

```text
4AllPass → “here is the API key” → Tollgate is trusted with the vault’s prize
```

Better:

```text
4AllPass → signed capability → Tollgate Verify + policy → Provider
```

Tollgate checks the capability **cryptographically** and never reads the 4AllPass snapshot.

That implies a **Capability Signing Key (CSK)** that is **not** the Vault Key, not DK, not DWK, not the master password. Tollgate holds at most a **verify** half (or a dedicated HMAC key that is *only* the contract key).

Honest vs protocol v1:

- Vault wrapping stays **symmetric** (`post-quantum-roadmap.md`). Do not sneak X25519/ML-KEM in as “we needed capability signatures.”
- A later CSK (e.g. Ed25519 verify in Tollgate, private half only on the unlocked 4AllPass device) is a **new, optional primitive** for this contract — not envelope wrapping, not `cryptoVersion` for entries.
- Shared HMAC between two local processes is simpler and **couples** them: compromise of Tollgate’s contract key lets an attacker mint caps, not unwrap VK. Still worse than a verify-only public half. Pick at implementation time; do not ship HMAC-as-VK.

---

## 5. How the provider gets a key (decide later)

Not part of 4AP-CAP-1 wire. Three options, best last:

| | Path | Trust | Note |
|---|---|---|---|
| **A** | Tollgate receives the secret temporarily | Highest | Easy. 4AllPass *does* trust Tollgate with bytes. Allowed only as an explicit, ugly mode. |
| **B** | 4AllPass issues a short-lived *use* (broker injects per call, or a time-boxed derived token 4AllPass understands) | Lower | Secret need not sit in Tollgate’s `keys_app.json`. |
| **C** | Upstream provider issues short-lived credentials (OAuth access token, cloud STS, …) | Lowest | Permanent secret never leaves 4AllPass. **Prefer this when the provider supports it.** |

Variant C is why we do not invent a new token format on day one: use the provider’s.

Expiry of the capability still does not un-know bytes already given (same as `secret-access-layer.md` §2.1). Rotate the upstream secret to revoke a leak.

---

## 6. What we will not build first

- A proprietary super-protocol or “Agent Security SDK” with hundreds of methods
- 4AllPass as OIDC provider for the vault
- MCP tools that return plaintext secrets as the happy path
- Spend policy inside 4AllPass
- Vault contents inside Tollgate
- Secrets inside Gnom-Hub
- Signing caps with VK / DK / DWK

---

## 7. Triggers to implement

- Secret Access Layer (`#67`) exists **and** Tollgate is a Trusted Application.
- Explicit “implement 4AP-CAP-1” (not “weiter”, not “MCP”, not “merge”).

Until then this file is a **contract sketch**. No code in this repository issues, verifies, inspects, or revokes capabilities.
