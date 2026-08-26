# Team roadmap — 4AllPass

**Status:** Planning. **Not implemented.** Review spec: [`team-mode.md`](team-mode.md). Must not become PAM.  
**Date:** 2026-08-23 (rev. 2)

One product. Solo local stays default. Team is an extra layer on the server profile.

North star: organization = boundary; employee = vault + agents + policies; recovery = **cooperation**, not admin unwrap.

Not: Admin → Policy → Employee → Agent → Credential.

---

## PHASE 1 — Trusted Team (3–5 people)

**In:**

- Organization, members, invites (`admin` | `member`)
- OrgDevice = existing `device_id`; org-revoke ≠ vault hard-revoke
- Resources + OrgBoundary (ceiling, default deny)
- EffectiveAccess = OrgBoundary AND EmployeePolicy AND agent policy
- Employee agent policies in vault ciphertext
- Agent keypair (WebCrypto); loopback broker kept
- Encrypted backup = sealed snapshot
- **Trusted Recovery:** XOR 2-of-2 of the **existing** Recovery Key (not VK, not a new wrap layer, **not Shamir in MVP**)
- Employee Share A (card) + Organization Share B (org property / opaque server blob)
- Recovery session; combine **only** on the employee device
- Recovery readiness flags; diagnostics without secrets
- Org audit (membership / device / resource / recovery) — not credential access
- Same Tauri app

**Out:**

- SSO, SCIM, LDAP, custom RBAC
- PAM / surveillance / admin credential or agent-policy view
- Central credential broker, FastAPI `/v1/access`, HSM
- Organization vault / shared secrets / JIT
- Shamir k-of-n, splitting VK, combine on server or admin UI
- Full Emergency Kit **plus** Share A for the same team member (that fakes dual control)
- Second app

**Crypto note:** `packages/crypto` gains share encode/XOR next to `recovery.ts`. No new envelope `type`. Solo kit path unchanged.

**Exit:** DoD in `team-mode.md`. **Blocked on** an explicit implement decision.

---

## PHASE 2 — Organization vault / shared secrets

Company-owned vault (own VK). Shared credentials. Wrapping to **member devices** needs **public-key wrapping**, which v1 does not have.

Do not fake this with `4allpass-share-v1`. Do not put `organization_id` on personal vaults in Phase 1.

Still forbidden: admin opening an **employee** vault.

Optional here: Shamir 2-of-3 / 3-of-5 **on the Recovery Key** if a 3–5 person shop outgrows XOR 2-of-2 availability (lost card). Not on VK.

---

## PHASE 3 — Optional enterprise

OIDC for **account** login (still cannot unwrap VK). SCIM/LDAP for membership. Extra roles that still cannot read vaults. Signed org audit.

Not: PAM, session recording, FastAPI cloud-token mint.

---

## PHASE 4 — Advanced machine / agent identity

OS-attested process identity, hardware-backed agent keys, pairing without a long-lived bearer token. Loopback + Origin 403 remain.

---

## Never a phase

- Admin master-password reset
- Server-held RK or VK escrow
- Combine shares on FastAPI
- “Support can restore your vault”
- Tollgate spend policy inside 4AllPass
- MCP as the security interface
- A second crypto stack

---

**Stand:** 23. August 2026  
**Next:** wait. See `team-mode.md` verdict + §25.
