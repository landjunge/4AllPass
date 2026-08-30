# Agent access (4AllPass)

**Status:** Proposed.  
**Implemented today:** string `n8n` + pairing token + human Allow; grant `handoff: "raw_secret"`; TTL does not un-know a copy.  
**Not implemented:** MAIP verify, mediated proxy, `vault.read_all` denial as a new engine (unknown app DENY already exists).  
**Authoritative today:** [`../security-boundary.md`](../security-boundary.md) §7.  
**Date:** 2026-08-26

> Agents receive capabilities, not vault access.

Companion: [`../specs/maip-v0.1.md`](../specs/maip-v0.1.md), [`../secret-access-layer.md`](../secret-access-layer.md) (egress module, **later**), [`../local-access-broker.md`](../local-access-broker.md) (what runs), [`../security-boundary.md`](../security-boundary.md) §7.

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

---

## Headless / robot requesters (later, not v1)

**Status:** Library prototype 2026-08-30. **Not wired to the sidecar.** Do not treat this as always-allow for string `n8n`.  
**Source:** maintainer draft (`robot-interface-draft.md`). Corrected against [`../security-boundary.md`](../security-boundary.md).  
**Transport:** protocol-agnostic. The broker still only answers “who is asking, and may they?”. No device protocol, no discovery, no vendor API.

4AllPass does **not** drive devices. Whatever talks to the hardware (a vendor API, MCP, HTTP, …) is out of this repo. The headless box is another **requester** of the loopback broker, like n8n. Same `packages/access` / `broker.py` model. No parallel device SKU. No second broker.

### Why the live popup is not enough

Today every grant waits for a human in the desktop window. A field or lab robot often has nobody at that moment.

| Mode | When | What |
|---|---|---|
| **Live Allow** | Human is present (commissioning, test) | Today’s overlay / prompt |
| **Standing rule** | After a live enrollment | Broker matches a human-written rule. Not a blank check |

Standing rule is **always-allow for a bound identity**. Forbidden in v1 until MAIP exists. [`../secret-access-layer.md`](../secret-access-layer.md) Phase D: do not ship “always allow” while `application` is still a string.

### Identity is MAIP, not a vault Device envelope

The draft reused WebAuthn Device envelopes (`PRF → DWK → Device Key → Vault Key`). **That mix is a defect.**

| Object | Question | Must not |
|---|---|---|
| Vault **device** | Can this human device unwrap the VK? | Be an n8n or robot principal |
| Agent / robot | May this requester use secret X after Allow? | Unwrap VK, sit in `packages/crypto` |

- The broker never sees master password, VK, DK, DWK, PRF, or plaintext. It never creates Device envelopes.
- Enrollment (later): robot generates a keypair in a TPM / secure element; human **live-Allows once**; registry stores the MAIP document (`maip:ed25519:<sha256 of pubkey>`). Each later request is signed. No long-lived shared token as identity.
- Revoke the robot in the MAIP registry. Vault `deviceKeyVersion` / `hardRevokeDevice` rotates the **vault**, not the agent. Do not “cut a robot” by bumping VK.

Suggested enrollment (same shape as § Enrollment above, hardware-backed if the board has it):

1. Robot generates a non-exportable keypair.
2. It offers public key + metadata (type, optional MHS manifest ref).
3. Human confirms live — unknown = DENY until that click.
4. Registry stores the MAIP document. Independently revocable.
5. Later requests: signed `agent_id` + nonce + action + resource. Verify MAIP **then** policy.

### Risk class (policy later, not crypto)

Physical mistakes are worse than a leaked read-only API key (MHS/Genentech: a foam error treated as a software bug).

| Class | Example | Rule if this ever ships |
|---|---|---|
| **data** | Read-only sensor / DB | Standing rule possible after enrollment; short TTL |
| **actuation** | Arm, valve, drive | Never `raw_secret` without a **live** Allow. No standing auto-approve, including overnight |

Additive `riskClass` on `@4allpass/core` policy when this ships. The **human** sets the class at enrollment. Do not infer it from MHS metadata in the first cut (misclassification).

### Hard limits (only if standing rules exist)

- Rate-limit per agent id. A compromised box asks at machine speed.
- Hard TTL ceiling in request parse / `evaluatePolicy`. Today `ttlSeconds` is any finite `> 0` — that gap is real; it is **not** product-audit F-5 (`GET /local/broker` for `local@`).
- Optional time window / network segment if the requester can prove them.
- Standing rules expire after N days; human re-confirms. No permanent blank cheque.
- Offline robot: next signed request fails if the local registry revoked it. Do not pretend VK rotation reaches a robot that is offline.

### Audit

Log agent id (pubkey hash), time, credential id (not the secret), `riskClass`, which rule matched. Same rule as `test_allow_flow_does_not_log_secret`. Logs are not proofs ([`future-architecture.md`](future-architecture.md)).

### Open (from the draft)

1. One MAIP identity per MHS manifest, or one identity for several MHS devices?
2. Human-set vs inferred `riskClass` — default human.
3. Four-eyes for actuation?
4. If public MHS ships its own auth that collides with MAIP, rewrite this chapter. Do not implement against the research preview as if it were a spec.

### Maintainer decisions (you write; Grok does not guess)

Fill these **before** anyone wires standing into the sidecar. Library defaults
are already coded; change them here in a sentence, then a later PR can follow.

- [ ] **Actuation overnight.** Today: `riskClass: "actuation"` never auto-approves, including a repeating harmless motion at night. Keep? Or name the exceptions.
- [ ] **Who sets `riskClass`.** Today: human at enrollment. Never inferred from a transport. Keep?
- [ ] **Standing max age.** Today: 7 days (`STANDING_RULE_MAX_AGE_MS`). Other N?

Human-first queue (npm scope, read the review yourself, run the tests yourself): `ROADMAP.md` §0b.

### Human prep (not Grok code)

1. Claim `@4allpass` on npmjs (`ROADMAP.md` §0b #1).
2. Secure-element on the target board (private key never leaves it) — independent of any device protocol.
3. Do not wire the sidecar to always-allow while the caller is only pairing token + string `n8n`.

### What was built (library, 2026-08-30)

1. **Enrollment / signature** — `packages/crypto/src/requester.ts`. Public key in, `req:ed25519:<sha256>` out. Each request is a signature over canonical bytes. Verify takes `expectedRequesterId` (same expectation style as `unwrapDeviceKey`). Wrong key → `AuthFailureError`. Id/key mismatch → `IntegrityError`. Rotation mints a **new** id; the old key cannot authenticate as the new one. Private keys never enter the module. Tests: `packages/crypto/test/adversarial-requester.test.ts`. **Does not** create a Device envelope or wrap a Vault Key.
2. **`riskClass`** — additive on `Credential` (`data` default, `actuation` human-set). `evaluatePolicy` reports it. Actuation is high-risk on the live path and **never** standing-auto-approved, even if a rule claims `data`. Tests: `packages/core/test/standing-grant.test.ts`.
3. **Standing grants** — parallel path `decideStandingAccess` in `packages/core/src/access/standing.ts`, not a silent override of `decideAccess`. Requires `requesterId` (signature already verified by the caller). Rate-limit per id (10 / 60s). Hard TTL: parser max 86400s (`ttl_too_large`); standing clamp 300s. Rules expire after 7 days (`STANDING_RULE_MAX_AGE_MS`). String `application: "n8n"` is not identity on this path. Sidecar / `broker.py` is **unchanged** (still live Allow).

**Do not:** wire this into the sidecar as always-allow for a pairing token; mix vault envelopes with agent identity; FastAPI token mint; a 4AllPass device protocol; infer `riskClass` from a transport.
