# Team roadmap — 4AllPass

**Status:** Planning. Phase 1 is specified in [`team-mode.md`](team-mode.md) and **not implemented**.  
**Date:** 2026-08-23

4AllPass stays **one product**. Team is an extra organization layer. Solo local (SQLite, no email) stays the default until someone points the app at a team server.

Product-maturity P0→P1 (Install, Import, Autofill) is still the next **code** sequence. This file is so Team Mode is not invented as PAM later.

North star (do not invert):

```text
Organization = boundary
Employee = vault + agents + policies
4AllPass = enforce the intersection + help when something breaks
```

Not: Admin → Policy → Employee → Agent → Credential.

---

## PHASE 1 — Trusted Team (3–5 people)

**Goal:** A small company can share a self-hosted 4AllPass **server** for accounts, membership, company resource names, and a ceiling. Each person still owns their vault. Admins help with lost devices. Nobody watches keystrokes.

**In:**

- Organization, members, invites (`admin` | `member`)
- OrgDevice bound to the existing `device_id`; org-revoke ≠ vault hard-revoke
- Organization resources (names/providers, no credentials)
- EffectiveAccess = OrgBoundary AND EmployeePolicy AND existing agent policy
- Employee agent policies (ciphertext in the employee vault)
- Cryptographic agent identity (WebCrypto keypair; loopback broker kept)
- Encrypted backup = sealed snapshot export/import
- Recovery **assistance** (org-revoke + re-enrol). No admin unwrap key
- Diagnostics without secrets
- Org audit of membership/device/resource/recovery events — not credential access
- Same Tauri/PWA app; extra tabs only where responsibility differs
- Solo mode unchanged

**Out (do not build in Phase 1):**

- SSO, SCIM, LDAP
- Custom RBAC
- PAM / session recording / admin credential view
- Central credential broker / FastAPI `/v1/access`
- HSM
- Enterprise compliance packs
- Permanent agent monitoring
- Admin access to employee vaults
- Organization vault / shared secrets
- JIT credential issuing
- New primitives in `packages/crypto`
- Second desktop app

**Exit:** The twenty DoD items in `team-mode.md` §19, with the tests in §18.

**Host:** existing FastAPI **server** profile (SQLite is enough for 3–5 people). Not the local singleton.

**Blocked on:** explicit maintainer “implement slice N”. Review-only until then.

---

## PHASE 2 — Organization vault / shared secrets

**Goal:** Some secrets belong to the **company** (CI token, shared Cloudflare, production bot) without giving the admin every employee’s personal GitHub.

Possible shape (not a spec yet):

- Organization-owned vault (own random VK, own envelopes)
- Shared credentials as items in that vault
- Key envelopes / wrapping to **member devices** — this needs **public-key wrapping**, which v1 does not have (`docs/sharing.md`, `docs/post-quantum-roadmap.md`)
- Rotation and ownership transfer that do not copy plaintext through the admin’s laptop “for convenience”

**Do not fake Phase 2** with `4allpass-share-v1` files renamed to “org vault”. A share is a new VK and is not remotely revocable.

**Still forbidden:** admin opening an **employee** vault.

Phase 1 schema must not put `organization_id` on personal `Vault` rows.

---

## PHASE 3 — Optional enterprise

**Goal:** Larger orgs can hook existing identity, without making 4AllPass a directory.

Optional, default off:

- SSO (OIDC) for **account** login — still zero influence on vault unwrap (crypto invariant #5)
- SCIM / LDAP for membership sync
- More than two roles (e.g. billing vs admin) — still no “read vault” role
- Signed org audit, retention, export
- Policy templates for resources (“staging vs production”)

**Still out unless explicitly reopened:** PAM, session recording, JIT per-call tickets as the product, HSM-as-required, pretending FastAPI can mint cloud tokens.

---

## PHASE 4 — Advanced machine / agent identity

**Goal:** An agent is a principal, not a display name.

- OS-attested process identity where the platform allows it (macOS code signature / bundle id)
- Hardware-backed agent keys if/when available
- Pairing that does not depend on a long-lived printed bearer token
- Revoke that binds to the key, not to the string `"n8n"`

Loopback + Origin 403 remain. The broker still does not become a global secret bus.

Until this phase, Phase 1’s Ed25519 (or equivalent) agent keypair + pairing token as **channel** is the honest middle ground.

---

## What never becomes a phase

- Admin master-password reset
- Server-held vault escrow
- “Trust us, we cannot see it, except for support”
- Merging Tollgate spend policy into 4AllPass
- MCP as the security interface
- A second crypto stack beside `packages/crypto`

---

**Stand:** 23. August 2026  
**Next:** wait. See `team-mode.md` §17.
