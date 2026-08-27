# Team Mode — Architecture Review and Phase-1 Spec

**Status:** Review only. **Not implemented.**  
**Date:** 2026-08-23 (rev. 2 — Trusted Recovery 2-of-2)  
**Companion:** this file (spec), [`recovery.md`](recovery.md), [`crypto-protocol.md`](crypto-protocol.md), [`security-boundary.md`](security-boundary.md), [`webauthn-prf.md`](webauthn-prf.md), [`local-access-broker.md`](local-access-broker.md), [`threat-model.md`](threat-model.md), [`vault-revision.md`](vault-revision.md)

P0/P1 (Install, Import, Autofill) remain the next **code** sequence. This document is not a license to start Team Mode PRs.

North star: organization = boundary; employee = vault + agents + policies; recovery = **cooperation**, not admin unwrap.

Not: Admin → Policy → Employee → Agent → Credential.

---

## Roadmap (planning, not implemented)

One product. Solo local stays default. Team is an extra layer on the server profile.

### PHASE 1 — Trusted Team (3–5 people)

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

**Exit:** DoD below. **Blocked on** an explicit implement decision.

### PHASE 2 — Organization vault / shared secrets

Company-owned vault (own VK). Shared credentials. Wrapping to **member devices** needs **public-key wrapping**, which v1 does not have.

Do not fake this with `4allpass-share-v1`. Do not put `organization_id` on personal vaults in Phase 1.

Still forbidden: admin opening an **employee** vault.

Optional here: Shamir 2-of-3 / 3-of-5 **on the Recovery Key** if a 3–5 person shop outgrows XOR 2-of-2 availability (lost card). Not on VK.

### PHASE 3 — Optional enterprise

OIDC for **account** login (still cannot unwrap VK). SCIM/LDAP for membership. Extra roles that still cannot read vaults. Signed org audit.

Not: PAM, session recording, FastAPI cloud-token mint.

### PHASE 4 — Advanced machine / agent identity

OS-attested process identity, hardware-backed agent keys, pairing without a long-lived bearer token. Loopback + Origin 403 remain.

### Never a phase

- Admin master-password reset
- Server-held RK or VK escrow
- Combine shares on FastAPI
- “Support can restore your vault”
- Tollgate spend policy inside 4AllPass
- MCP as the security interface
- A second crypto stack

**Stand:** 23. August 2026  
**Next:** wait. See verdict + §25.

---

## Verdict on the proposed recovery idea

The dual-consent rule is right:

> Recovery requires cooperation, not administrator access.

The **hierarchy** in the prompt is also right: do not split the Vault Key; do not give the admin VK.

Three parts of the prompt would be **wrong to implement as written**:

1. **Do not add a new Recovery Secret besides the existing Recovery Key.**  
   `packages/crypto` already has a 256-bit CSPRNG Recovery Key that is **not** VK. It becomes RWK via HKDF (`4allpass-recovery-wrap-v1`) and unwraps the Recovery Envelope. A second RK that wraps the first is another envelope, another rotation story, and no extra confidentiality.

2. **Do not implement Shamir polynomials for MVP 2-of-2.**  
   2-of-2 secret sharing of a 32-byte key **is XOR**: `shareB = RK ⊕ shareA` with `shareA` uniform random. Shamir over a prime field for `n=2` is more code, more encoding, more ways to get `mod p` wrong, and **zero** extra security. k-of-n (2-of-3, 3-of-5) is Shamir **later**. Do not pull a Shamir npm package for three-to-five people.

3. **Do not give the employee the full Emergency Kit *and* Share A.**  
   Then the employee recovers alone and “organization participation” is theater. Team split **replaces** the printable full RK: after both shares exist, the full RK is zeroized. Master password and enrolled devices stay independent unlock paths.

Scratch-off / QR / “sealed envelope” are **print UX**. Crypto must not depend on them. Reconstruction **only** on the employee’s new device — never on the admin laptop, never on FastAPI. If RK hits admin RAM, the admin has VK after one unwrap. That is a backdoor.

**Smallest correct construction:** split the **existing** Recovery Key with XOR 2-of-2; reconstruct locally; existing Recovery Envelope unchanged.

---

## 0. North star (not PAM)

Not: `Admin → Policy → Employee → Agent → Credential`.

```text
                    ORGANIZATION
                         │
                  boundary / trust
                         │
          ┌──────────────┴──────────────┐
          │                             │
      EMPLOYEE A                    EMPLOYEE B
          │                             │
     own vault                     own vault
          │                             │
     own agents                    own agents
          │                             │
    own policies                  own policies
          │                             │
          └──────────────┬──────────────┘
                         │
                    4AllPass
               enforce + assist
```

- Organization controls the **boundary**.
- Employee owns the **vault**.
- Employee manages **agents**.
- Recovery needs **both** employee share and organization share.
- 4AllPass enforces the intersection.

```text
EffectiveAccess = OrganizationBoundary AND EmployeePolicy AND AgentPolicy
```

Org allow is a **ceiling**, not an order.

---

## 1. Current architecture map

One product, two run profiles, **no** org tables.

| Layer | Path | Today |
|---|---|---|
| Crypto | `packages/crypto` | Argon2id, AES-256-GCM, envelopes (master / device / recovery), sealed manifest, `vaultKeyVersion` |
| WebAuthn | `packages/webauthn` | PRF > largeBlob > UV-gated → DWK → DK → VK. Server never sees PRF |
| Policy | `packages/core` | `evaluatePolicy` / `decideAccess` / `issueGrant`. Application is a **string**. Unknown = DENY. Grant has **no secret** |
| Access client | `packages/access` | Loopback only. Pairing token. Not FastAPI |
| Broker (dev) | `packages/broker` Node `:8787` | Queue. Not the product path |
| Broker (product) | `backend/app/broker.py` | `127.0.0.1:8788`. Origin 403 on grant path. Relay only |
| Providers | `packages/providers` | Domain ≠ provider |
| Storage | `backend/` FastAPI | Accounts, `get_owned_vault` → 404, snapshot CAS, opaque blobs |
| Models | `User`, `Vault`, `Device`, `VaultSnapshot`, envelopes, entries, WebAuthn rows | No Organization / Member / Resource |
| Desktop | `src-tauri/` + same frontend | Unlock = master password. PRF in WKWebView **unproven** |
| UI | Entries, Access, Devices, Settings | No Team |
| Recovery | Emergency Kit + Recovery Envelope | Single 256-bit RK. No split. No server reset |
| Audit | `auditLine` in core | Local access rows, no secrets. No org events |

| Profile | Host | Identity |
|---|---|---|
| Local / solo | SQLite in Application Support, loopback | Singleton `local@127.0.0.1` |
| Server | FastAPI + SQLite or Postgres | Email + account password. Many users. Still never decrypts |

Team **cannot** live in the local singleton. Host org metadata on the **server profile**. Solo stays default when `teamServerUrl` is empty.

---

## 2. Current crypto architecture

Authoritative: [`crypto-protocol.md`](crypto-protocol.md). Hard invariants that Team Mode must not touch:

1. Vault Key is always random — never derived from a password.
2. AES-256-GCM nonces are library-generated; never reused with the same key.
3. Every seal uses canonical AAD (`encodeAad`).
4. Master password never leaves the client.
5. Account password / OAuth have **zero** influence on unwrap.
6. Versions are explicit (`vaultKeyVersion`, `deviceKeyVersion`, `cryptoVersion`).
7. Open paths take the **caller’s expectation** (`expectType`, ids, versions) **before** decrypt.
8. `revision` is only trusted after the sealed manifest verifies.

Server stores opaque envelopes and ciphertext. It does not “verify” PRF. It does not invent VK.

Team Mode adds **no** new envelope `type`. Recovery shares are **not** a fourth envelope. They are an encoding of the existing Recovery Key.

---

## 3. Current vault-key hierarchy

```text
                    Random 256-bit Vault Key (VK)
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
  Master Envelope       Device Envelopes       Recovery Envelope
  Argon2id → MK         DK (per device)        Recovery Key → HKDF → RWK
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              │
                              ▼
                     AES-256-GCM + AAD
                     (entries + sealed manifest)
```

WebAuthn is **not** an encryption oracle for VK:

```text
PRF (32 bytes, never used as a key)
  → HKDF → DWK
  → unwrap Device-Key Envelope → DK
  → unwrap Device Envelope → VK
```

**Do not** insert Organization or Shamir on the VK line. Dual-control belongs on the **Recovery Key**, which already exists solely for disaster unwrap.

---

## 4. Current device identity

`frontend/src/lib/device-identity.ts`: stable `dev_` + 12 random bytes in `localStorage`. Bound into Device Envelope AAD and DWK HKDF `info`.

Server row (`devices`): `vault_id` + `device_id`, display name, platform, `revoked_at`. Unique `(vault_id, device_id)`.

`X-Device-Id` is **client-asserted**, not a WebAuthn proof. Stolen session + stolen device id still talks to the storage API. It still cannot decrypt VK₂ after hard revoke.

Team binds **the same string** as `OrgDevice.deviceId`. No second identity system.

---

## 5. Current WebAuthn / PRF flow

Authoritative: [`webauthn-prf.md`](webauthn-prf.md), [`security-boundary.md`](security-boundary.md) §3.

- Challenges are server-issued, hashed at rest, single-use.
- `cose_verified` = ceremony integrity (`fmt=none` + assertion). **Not** PRF proof.
- Server never sees PRF output, DWK, or DK plaintext.
- Fallback: PRF > largeBlob > UV-gated local store > master password.
- Measured Tauri WKWebView: `prf` is **null**. Team must not claim passkey-bound org devices.

OrgDevice enrolment is metadata: “this `device_id` belongs to member X.” Crypto unlock stays on the employee client.

---

## 6. Current broker architecture

Authoritative: [`local-access-broker.md`](local-access-broker.md), [`security-boundary.md`](security-boundary.md) §7.

```text
agent  POST 127.0.0.1:8788/v1/access/request
       Bearer <pairing token>
       Origin http(s)://…  →  403
            │
            ▼
broker.py   relay only (never decrypts, never mints provider tokens)
            │
            ▼
unlocked UI  decideAccess() → human Allow/Deny → material from vault
             auditLine() omits secrets
```

Keep: loopback, Origin 403, pairing token as **channel**, policy in the UI, FastAPI without `/v1/access`. Do not make the org server a credential broker.

---

## 7. Current agent access flow

```text
application: "n8n"     // TRUSTED_APPLICATIONS = ["n8n"]; unknown DENY
parseAccessBody → evaluatePolicy(credentials)
  deny: application_not_allowed | no_credential | scope_not_permitted | …
  allow: eligible for HUMAN Allow (not auto-handoff)
issueGrant → metadata, TTL, no secret
UI attaches access_token / password only after Allow
```

Identity is a **string**. Pairing token is the wire gate. A process with the token can claim `"n8n"`.

Team needs a keypair **in the access layer** (WebCrypto Ed25519, versioned `agent-identity-v1`), verified in the unlocked UI before `evaluatePolicy`. Not in `packages/crypto` vault protocol. Broker still only relays.

---

## 8. Current backup / snapshot architecture

Authoritative: [`vault-revision.md`](vault-revision.md).

The unit of backup **already is** the immutable snapshot: envelopes + encrypted entries + sealed manifest, CAS on `expectedRevision`, reject `vaultKeyVersion` decrease.

| Mechanism | Same vault? | Plaintext? |
|---|---|---|
| Active snapshot on server | yes | no |
| IndexedDB last verified wire snapshot | yes | no |
| `4allpass-share-v1` | **no** (new VK) | no |
| Emergency Kit | unwraps Recovery Envelope | the key **is** the secret |

Team backup = **export the opaque wire snapshot**. Do not invent a parallel backup AEAD. Do not tell anyone to “send a share file” as restore of the same vault.

Restore of the same vault: snapshot + master **or** reconstructed RK. First-run “I have a vault” currently imports a **share** into a **new** vault — different path.

---

## 9. Current revocation architecture

| Name | Effect |
|---|---|
| Metadata `DELETE /devices/{id}` | `revoked_at`. Response `revocation: "metadata_only"`. Not cryptographic erase |
| Soft revoke | Next snapshot **omits** that device envelope, same `vaultKeyVersion` |
| Hard revoke | Employee `hardRevokeDevice`: VK++, re-encrypt, omit target, CAS, then metadata DELETE |

A client that already holds VK still decrypts snapshots sealed under that VK until hard rotate.

**Team org-revoke is a fourth, organizational bit.** It must not be named “rotate vault key”. Stolen laptop that may hold VK still needs the **employee** to hard-revoke.

---

## 10. Current audit architecture

`packages/core` `auditLine` / `auditEvent`: local access decisions (application, provider, scope, APPROVED/DENIED). `auditContainsSecret` tests that secrets are absent.

No hash chain. No org events. No signatures.

Team org audit is a **new** table of membership/device/resource/recovery events, `prevHash` chain, **not** an export of `auditLine`. Shipping “opened GitHub at 14:32” to the admin is PAM.

---

## 11. Team Mode gap analysis

| Object | EXISTING | REUSE | MODIFY | NEW | DEPRECATED |
|---|---|---|---|---|---|
| VK / envelopes / manifest | yes | must | no new envelope type | — | — |
| Recovery Key + RWK + Recovery Envelope | yes | **split this RK** | share encode/decode next to `recovery.ts` | XOR 2-of-2 helpers + KATs | printable **full** RK for **team** members after split |
| Emergency Kit (solo) | yes | unchanged | — | — | — |
| User / vault ownership 404 | yes | org ≠ owner | — | Member → `user_id` | — |
| `device_id` | yes | same string on OrgDevice | org-revoke flag | `OrgDevice` | second device id |
| WebAuthn/PRF | yes, unproven in Tauri | enrol as today | — | — | Tauri-biometrics envelope |
| Agent string + pairing token | yes | token = channel | `effectiveAccess` AND | Agent keypair (WebCrypto) | string-only identity **when Team is on** |
| `evaluatePolicy` | employee-only | solo default | optional org + agent AND | — | admin PDP |
| Snapshot as backup | yes | export/import UI | — | — | share-v1 as “backup” |
| Recovery ceremony | kit typed locally | unwrap path | session + dual share input | RecoverySession, OrgRecoveryShare blob | admin unwrap key; server-side combine; Shamir-for-2 |
| Access audit | local | diagnostics | do not copy to admin | OrgAudit events | credential-access org log |
| Local solo | yes | unchanged | org routes 404 | — | — |
| Server profile | yes | host org + opaque org share | `/api/v1/orgs` | Organization, Member, Invite, Resource, OrgBoundary, RecoverySession | `organization_id` on `Vault` |
| Org vault / shared secrets | no | leave room | — | Phase 2 (needs public-key wrap) | fake it with share-v1 |
| SSO / SCIM / LDAP / RBAC / PAM / HSM / JIT | no | — | — | Phase 3+ / never | — |

---

## 12. Proposed organization model

```text
Organization
  id, name, createdAt, ownerUserId, status (active|suspended), schemaVersion=1

Member
  id, organizationId, userId, role (admin|member), status (pending|active|suspended|removed), createdAt

Invite
  id, organizationId, email, role, tokenHash, expiresAt, createdByMemberId, acceptedAt
```

Admin: invite, suspend, remove, re-enable (`removed`/`suspended` → `active` if the user still exists). No custom RBAC.

Invite accept links/creates `User`, sets member `active`. Employee creates **their own** vault. Invite does not wrap VK.

---

## 13. Proposed employee / device / agent identity

```text
Employee User
  └── owns Vault (unchanged)
        ├── devices[]           // crypto envelopes
        └── OrgDevice bind      // metadata: this device_id belongs to Member

AgentIdentity v1  (vault ciphertext, not FastAPI)
  version, type: "agent-identity-v1"
  id, label, publicKey, deviceId, status, createdAt

AgentPolicy v1    (vault ciphertext)
  agentId, resourceId?, provider?, capabilities[], effect
```

Pairing: challenge from unlocked UI, agent signs, employee Allow stores pubkey. Pairing token remains loopback **channel** auth.

Org does not approve each agent. Default: **do not upload** agent pubkeys. Stolen agent → employee revokes locally; org can deny member or resource.

---

## 14. Proposed access model

```text
1. Member active?                         else DENY member_inactive
2. OrgDevice active for this device_id?   else DENY device_revoked
3. Org resource? boundary allow?          else DENY org_boundary
   (non-resource personal items: skip org layer)
4. Agent signature valid and not revoked
5. Employee AgentPolicy allow
6. Existing evaluatePolicy on the credential
7. Human Allow
8. Grant TTL as today
```

| Org | Employee/Agent | Result |
|---|---|---|
| allow | deny | DENY |
| deny | allow | DENY |
| allow | allow | pending human Allow |

TTL and “already copied secret cannot be un-known” stay honest.

---

## 15. Proposed recovery key hierarchy

**Do not change the VK line.** Add a split **under** the existing Recovery Key:

```text
VK  (unchanged)
 └── Recovery Envelope  (type="recovery", unchanged wrap)
       wrapping key = RWK
       RWK = HKDF-SHA-256(
               IKM  = Recovery Key RK,          // existing 32-byte CSPRNG
               salt = SHA-256(4allpass-rwk-salt-v1 || vault_id),
               info = 4allpass-recovery-wrap-v1 || vault_id || crypto_version
             )

RK  (existing; NOT VK; never stored on the server)
 ├── Solo: printed Emergency Kit (today)
 └── Team: XOR 2-of-2, then ZEROIZE RK
       shareA  = CSPRNG(32)                    // employee card
       shareB  = RK ⊕ shareA                   // organization envelope
       RK      = shareA ⊕ shareB               // reconstruct locally only
```

Domain-separated **share encoding** (new, next to `formatRecoveryKey`):

```text
payload = share_bytes(32) || checksum(2)
checksum = SHA-256( frame(["4allpass-recovery-share-checksum-v1",
                           vault_id, recovery_id, share_index, share_bytes]) )[0..2]
encoded  = Crockford-Base32, groups of 5  (reuse existing alphabet)
header (printed, not secret): vault_id, recovery_id, share_index (1=employee, 2=org), schemaVersion=1
```

`recovery_id` is a new random id per RK generation (not the raw RK). It binds prints to one split. After RK rotation, old `recovery_id` must fail combine-or-unwrap (unwrap AEAD fails if someone combines the wrong generation; also check `recovery_id` before XOR).

Integrity of the reconstructed RK is the existing Recovery Envelope GCM tag plus the share checksum (typos, not a second MAC).

**Later k-of-n:** replace XOR with Shamir in the same encode/decode slot (`schemaVersion=2`). Do not design that now.

---

## 16. Proposed 2-of-2 recovery architecture

### What each party holds

| Party | Holds | Alone |
|---|---|---|
| Employee | Share A (card), master password, device keys, sealed snapshot (server or file) | Cannot reconstruct RK. **Can** still unlock with master or an enrolled device |
| Organization | Share B (opaque server blob + printed org envelope). **Not** an admin’s personal kit | Cannot reconstruct RK. Cannot unwrap Recovery Envelope |
| Server | Snapshot (Recovery Envelope + ciphertext) + optional Share B blob | Cannot reconstruct RK. Dump + Share A (stolen card) **can** — residual, see threat model |
| Admin laptop | Never RK, never VK, never Share A | If we reconstruct there, the design has failed |

### Independent paths (do not collapse)

1. **Normal lost laptop, master remembered:** fetch snapshot, unlock with master, enrol new device, admin org-revokes the old `deviceId`. Shares unused.
2. **Second device still enrolled:** unlock there. Shares unused.
3. **Disaster (no device, no master):** Share A + Share B + snapshot + recovery **session** → local RK → RWK → Recovery Envelope → VK → new master + new split.

Path 3 is the only path that needs the org. That is “help when needed,” not “admin owns recovery.”

### Availability cost (must be said at enrolment)

If the employee loses **Share A** and forgets the master and has no other device, the org **cannot** help. 2-of-2 dual control **is** that tradeoff. UI copy (DE+EN) at split time, confirmation required.

### Where Share B lives

Recommended for 3–5 people:

- Opaque blob on the org server, keyed by `(organizationId, memberId, recoveryId)`. Any **active admin** may retrieve it for a ceremony. It is useless without Share A.
- Printed Organization Recovery Envelope with the **same bytes**, stored as **org property** (safe), not on one admin’s USB. Admin turnover: the print stays; the new admin uses the server blob or the envelope.

Share B is **not** wrapped under an admin personal key (that makes recovery die when that admin leaves, and puts RK-adjacent material in a personal vault).

Share A **never** uploaded.

### What we refuse

| Idea | Why not |
|---|---|
| Split VK | Breaks master/device envelopes; reconstruct-on-unlock or store VK |
| New RK wrapping the existing RK | Extra envelope, extra rotation, no confidentiality gain |
| Shamir library in MVP | 2-of-2 = XOR |
| Combine on FastAPI or admin UI | Admin/server would see RK → VK |
| Full kit + Share A both given to employee | Dual control is fake |
| Scratch-off as a cryptographic assumption | Ops only |
| Org share in the admin’s own vault | Org material must survive admin change |
| Reconstruct without the snapshot | RK without Recovery Envelope cannot produce VK — by design, keep it |

---

## 17. Physical Recovery Card / Organization Envelope

Print templates in the app. Same Crockford string as the digital share. QR encodes that string, not a second secret.

**Employee Recovery Card**

- Title: 4AllPass Recovery Share A
- `recovery_id`, `vault_id` (or short), org name
- Human-readable grouped Crockford
- QR of the same payload
- Plain sentence: “Useless without the organization share. Not your vault password. 4AllPass cannot restore this if you lose it and forget your password.”
- Optional scratch-off **covering the Crockford** — convenience against casual photos, **not** a security claim

**Organization Recovery Envelope**

- Title: 4AllPass Organization Recovery Share B
- `organization_id`, `member_id` / employee label, `recovery_id`
- Same encoding
- “Property of the organization. Not a vault key. Useless without the employee share.”
- Stored as org custody

A photograph of either print **is** that share. Same class as today’s printed kit.

---

## 18. Recovery ceremony

Server state (**no secrets**):

```text
RecoverySession
  id, organizationId, memberId
  newDeviceId              // claimed by employee client
  challenge                // random, single-use
  status                   // pending | employee_confirmed | combining | completed | failed | expired
  expiresAt                // short, e.g. 15 minutes
  recoveryId               // expected share generation
  createdByMemberId        // admin
```

Flow:

1. Member is `active`. Admin starts recovery → audit `recovery.started`.
2. Employee, on a **new** device: storage login (account password — not VK). Confirms session + challenge. Binds `newDeviceId`.
3. Admin org-revokes the lost device(s).
4. Employee device fetches Share B **only** while session is `employee_confirmed` and unexpired. Share B is displayed **nowhere** on the admin screen as copy-paste into Slack; it is a binary download to the employee client over the authenticated session, or the employee types the org envelope while the admin holds the paper in the same room. Prefer in-app fetch during session so Share B is not sitting in chat logs.
5. Employee scans/types Share A.
6. Client: checksums → XOR → `deriveRecoveryWrappingKey` → `unwrapVaultKey({ expectType: "recovery" })` → VK.
7. Client immediately: new master envelope, new RK, new XOR split, enrol this device, CAS snapshot. Old shares die because the Recovery Envelope is replaced.
8. If the lost device may have held VK: employee **hard-revokes** (VK++) as part of the same unlocked session, then splits the **new** RK.
9. Audit `recovery.completed` or `recovery.failed`. Session cannot be reused.

Server receives: session ids, status, never RK, never shares in logs, never VK.

Removed/suspended member: start or confirm → 404. Offline combine of stolen shares + stolen snapshot dump still works (same class as stolen full kit today). Session is **authorization**, not a cryptographic kill switch. Crypto kill switch = new RK in a newer pinned snapshot.

Replay: consumed challenge + `expiresAt`. Expired session cannot fetch Share B.

Old backup: combine checks `recovery_id`; unwrap checks `vaultKeyVersion`. A malicious server serving an older snapshot is the existing first-use / pin problem; ceremony should show `vaultKeyVersion` + `recovery_id` both parties expect.

---

## 19. Threat model (Team + recovery)

Existing [`threat-model.md`](threat-model.md) still applies (malicious server cannot forge envelopes). Additions:

| Attacker | Can | Cannot | Mitigation | Residual |
|---|---|---|---|---|
| Compromised server | Dump snapshots + Share B; withhold data; serve old authentic snapshot | Reconstruct RK without Share A; forge Recovery Envelope | Combine only locally; pin revision after unlock; session does not hold RK | Dump + stolen card = RK |
| Malicious admin | Everything the server can for org metadata; retrieve Share B; suspend members | Unwrap Recovery Envelope alone; `get_owned_vault` of employee (404) | Dual control; no admin combine UI | Admin + stolen card = RK |
| Stolen employee device | Use cached VK until lock/hard-revoke; org access until org-revoke | Other vaults | Org-revoke + employee hard-revoke; auto-lock | RAM dump race (already accepted) |
| Stolen org envelope (Share B) | Hold 50% of RK | Unwrap | Employee keeps Share A offline; rotate RK if envelope theft is known | + stolen card |
| Stolen employee card (Share A) | Hold 50% of RK | Unwrap | Org keeps Share B; rotate if card theft known | + server dump or stolen envelope |
| Stolen Share B + compromised admin | Same as malicious admin | Alone, still no RK | Dual control | Hunt Share A |
| Compromised agent | TTL grant already given | Bypass employee deny / unknown-app DENY / missing signature (once keypair exists) | Pairing + policy AND | Secret already copied |
| Malicious local process | Loopback if pairing token stolen (today) | Browser Origin grant path | Origin 403; later agent signature | Token theft on the box |
| Replay attacker | Repeat an old grant request | Reuse consumed recovery challenge; expired grant | Session consume; grant TTL | Copies already given |
| Network attacker | See TLS to team server | See RK/VK if TLS holds | TLS; shares not in URLs | TLS MITM if client trusts a bad CA (self-host) |
| Former employee | Offline decrypt **their** ciphertext if they kept RK or both shares + snapshot | Org APIs; other vaults; new snapshot after RK/VK rotate | Remove member; employee should rotate before offboarding if possible | Historical ciphertext they already had |
| Compromised org admin device | Share B if they retrieve it | Share A, VK | Don’t display Share B in admin UI; fetch to employee client | Admin malware during ceremony |

**Recovery-specific cases from the prompt**

| Case | Result |
|---|---|
| Lost employee device, master known | No shares. New device + master. Admin org-revokes |
| Lost recovery card | Disaster path dead. Master / other device still work. Print a **new** split from an unlocked vault |
| Recovery session replay | Fail: consumed challenge / expired |
| Recovery session expiration | Fail: no Share B fetch |
| Already revoked org device used as “new” | Fail: bind a fresh `deviceId`; old id stays revoked |
| Old backup + new shares | Fail: `recovery_id` / AEAD |
| Vault-key rotation / hard-revoke | Old Recovery Envelope gone; must re-split **after** rotate |
| Recovery of removed member | Session 404. Offline stolen shares still unwrap old ciphertext — honest residual |

---

## 20. API changes

Prefix `/api/v1/orgs`. Server profile only. Local profile: 404.

Never accepted: master, VK, DK, DWK, PRF, RK, reconstructed RK, entry plaintext, agent private key, employee policy blob.

Foreign org/member ids → **404**.

| Method | Path | Who | Effect |
|---|---|---|---|
| POST | `/orgs` | authenticated user | create org; caller admin |
| GET | `/orgs/{id}` | member | metadata |
| POST | `/orgs/{id}/invites` | admin | invite |
| POST | `/orgs/invites/{token}/accept` | invited | member active |
| POST | `/orgs/{id}/members/{mid}/suspend\|remove\|reenable` | admin | status |
| POST | `/orgs/{id}/devices` | member self | bind `deviceId` |
| POST | `/orgs/{id}/devices/{did}/revoke` | admin | org-revoke |
| CRUD | `/orgs/{id}/resources` | admin | company names |
| PUT | `/orgs/{id}/boundaries/{memberId}/{resourceId}` | admin | allow\|deny |
| GET | `/orgs/{id}/boundaries/me` | member | own ceiling |
| PUT | `/orgs/{id}/members/{mid}/recovery-share` | **employee client** | upload **Share B** opaque (not A). Server stores bytes it cannot interpret |
| GET | `/orgs/{id}/recovery-sessions/{sid}/share-b` | employee, session `employee_confirmed` | download Share B once |
| POST | `/orgs/{id}/recovery-sessions` | admin | start |
| POST | `/orgs/{id}/recovery-sessions/{sid}/confirm` | employee | challenge |
| POST | `/orgs/{id}/recovery-sessions/{sid}/complete\|fail` | employee | status only |
| GET | `/orgs/{id}/audit` | admin | org events |
| GET | `/orgs/{id}/recovery-readiness/me` | member | flags: share A configured (client-asserted), share B present, snapshot exists — **no secrets** |

No `GET /orgs/{id}/vaults`. No FastAPI `/v1/access`.

Share B PUT happens **from the employee device at split time** (they generate both shares locally, keep A, upload B). The admin does not type Share B in.

---

## 21. Data model (additions)

Versioned. No plaintext secrets.

```text
OrgDevice
  organizationId, memberId, deviceId (same as vault Device.device_id)
  displayName, status (active|revoked), enrolledAt, revokedAt
  UNIQUE (organizationId, deviceId)

Resource
  organizationId, name, provider, status, metadata (non-secret), schemaVersion

OrgBoundary
  organizationId, memberId, resourceId, effect (allow|deny), version

OrgRecoveryShare
  organizationId, memberId, recoveryId, vaultId
  shareIndex = 2
  blob                 // opaque encoded Share B
  schemaVersion
  createdAt
  supersededAt         // on RK rotate

RecoverySession
  (see §18)

OrgAudit
  organizationId, type, actorMemberId, targetType, targetId, at, prevHash, rowHash
```

Event types: `member.invited|joined|suspended|removed|reenabled`, `device.enrolled|revoked`, `resource.created|changed`, `recovery.share_b_stored|started|completed|failed`, plus generic `security.event`.

**Not stored:** Share A, RK, VK, agent policies, credential access logs.

**Unchanged tables:** `users`, `vaults`, `vault_snapshots`, envelopes, entries, vault `devices`. No `organization_id` on `Vault`.

---

## 22. UI changes (same Tauri/PWA)

Solo: no Team chrome.

**Employee:** My Vault (default), My Devices, My Agents (Access stays grant UX, not first screen), Agent Policies, Organization (own ceiling), Backup (sealed snapshot export), Recovery (kit vs team split, readiness), Diagnostics.

**Admin extra:** Team → Members, Devices (org list), Resources, Boundaries, Recovery (start session — **cannot** paste VK), Diagnostics (receive redacted report), Audit.

Split enrolment UI: generate, show Card A, confirm printed, upload B, **zeroize RK**, show readiness. DE+EN: admin cannot restore passwords; losing the card without master is final.

Admin recovery UI: pick member, start session, wait. No share fields. No “unwrap vault”.

---

## 23. Test plan

Crypto (new class `adversarial-kdf-prf` or recovery tests in `packages/crypto`):

- `shareA ⊕ shareB = RK`; all-zero RK rejected as today
- Share A alone / Share B alone cannot derive RWK that unwraps
- Wrong `recovery_id` / swapped vault_id checksum fails
- Tampered share bits fail checksum or AEAD
- Combine then unwrap Recovery Envelope (KAT)
- After new split, old shares fail unwrap

Backend / policy / UI:

- Admin cannot decrypt employee vault (404 + ciphertext)
- Org cannot decrypt employee vault
- Employee cannot access another employee vault
- Revoked org device cannot pass EffectiveAccess
- Removed employee cannot call org APIs / start recovery
- Revoked agent cannot request grants; fake identity fails
- Org deny overrides employee allow; employee deny overrides org allow
- Valid org + employee policy → pending human Allow
- Expired grant fails; revoked device cannot use **new** grants
- Recovery requires employee confirm **and** org-started session
- Share A alone / Share B alone cannot recover
- Stolen Share B / compromised server cannot recover without A
- Session expires; consumed challenge cannot replay
- Recovery does not bypass org device revoke for **org** access (new device must bind)
- Recovery does not put VK/RK on admin API or in audit/diagnostics
- Backup file contains no plaintext; restore with master and with combined RK
- Diagnostics contain no secrets (`auditContainsSecret` style)
- Audit records recovery events, not credential access
- Solo: full kit still works; org routes 404; existing crypto tests green

---

## 24. Migration strategy

| Who | What |
|---|---|
| Solo local, never joins a team | **No change.** Emergency Kit as today. |
| New vault created **in** a team | Generate RK, wrap Recovery Envelope as today, XOR split, print A, upload B, zeroize RK. Never show full RK. |
| Existing vault joins a team | Unlocked client (master or old kit) generates **new** RK (normal envelope replacement, revision N+1), then split. Old full kit dies when the new snapshot is pinned — same as today’s kit rotation. |
| After hard-revoke | New VK, new Recovery Envelope, **new** split. Old A/B fail. |
| Admin change | Share B stays on org table / org envelope. No re-wrap. |
| Member removed | Session denied. Optionally org deletes Share B (availability only; they may have a print). Historical snapshot they already copied is still theirs. |
| Rollback of Team Mode | Leave org tables unused. Solo kit path remains. XOR helpers unused is fine. |

Do not migrate by uploading the **full** RK “so we can split later.” Split locally or not at all.

---

## 25. Exact MVP implementation order

Do not start until the maintainer names a slice.

| Slice | What |
|---|---|
| 0 | This review |
| 1 | Org + Member + Invite. Solo untouched |
| 2 | OrgDevice bind + org-revoke (copy: not hard-revoke) |
| 3 | Resources + OrgBoundary. Default deny. `/boundaries/me` |
| 4 | `effectiveAccess` AND in `@4allpass/core`; solo if no org context |
| 5 | Employee AgentPolicy in vault ciphertext |
| 6 | Agent identity v1 (WebCrypto); broker still loopback |
| 7 | Sealed-snapshot export/import (same vault) |
| 8 | **XOR 2-of-2 in `packages/crypto`** + KATs + share encoding. No Shamir |
| 9 | Split UX; Share B opaque PUT; recovery readiness flags |
| 10 | RecoverySession + local combine + new split after success |
| 11 | Print templates (card / org envelope). Scratch-off optional, not a claim |
| 12 | Diagnostics (no secrets) |
| 13 | OrgAudit including recovery events |
| 14 | Admin/Employee chrome |
| 15 | Tests in §23 |

Slices 8–11 are the recovery MVP. They **follow** org/member (need `memberId`) but the XOR library work (8) can land first with no API.

**Host:** server profile, SQLite enough for 3–5 people.

---

## 26. Risks and architectural conflicts

1. **Solo vs team host** — local singleton cannot be the org. Opt-in team URL.
2. **Org-revoke ≠ hard-revoke** — different words in the UI.
3. **Agent string vs keypair** — WebCrypto in access layer, not a new vault wrap.
4. **2-of-2 vs availability** — lost card + no master = dead vault. Must be explicit.
5. **Share B next to Recovery Envelope on the same server** — dump + stolen card = RK. Better than today’s dump + stolen **full** kit (kit is 100% of RK). Still document.
6. **Session is not crypto revoke** — removed employee with both shares + snapshot decrypts offline.
7. **Admin laptop combine** — forbidden. Easy to “simplify” in a PR. Block that PR.
8. **Access audit vs PAM** — do not copy `auditLine` to org audit.
9. **share-v1 vs backup** — different VK.
10. **PRF unproven in Tauri** — no passkey-org-device claim.
11. **`X-Device-Id` honesty** — OrgDevice is metadata.
12. **Uploading Share B** — employee client only; if an admin can *replace* Share B they can DoS recovery (availability), not steal VK. Authenticate PUT as the member; CAS on `recoveryId`.
13. **First-use snapshot choice** — unchanged malicious-server residual.
14. **Shamir “for later” in the XOR encoder** — do not abstract a `ThresholdScheme` plugin now.

---

## 27. Explicitly not in this MVP

- SSO, SCIM, LDAP
- Custom RBAC
- PAM, session recording, credential-access org logs, admin view of agent policies
- Central credential broker / FastAPI token mint
- HSM, compliance packs
- Organization vault / shared credentials / JIT
- Public-key wrapping to a foreign device
- Shamir 2-of-3 / 2-of-5 / 3-of-5
- A new Recovery Secret wrapping the existing RK
- Splitting VK
- Reconstruction on the server or admin UI
- Second desktop app / browser-only admin console
- New envelope types in `packages/crypto`
- Tollgate merge, MCP as security interface

---

## Recovery readiness (UX flags)

Client + server flags, **no secrets**:

```text
Vault backup     encrypted snapshot present     ✓/✗
                 integrity (manifest verify)    ✓/✗  (client, after unlock or on cached wire)
Recovery         employee share printed         ✓/✗  (client-asserted)
                 organization share stored      ✓/✗  (server has OrgRecoveryShare)
                 recovery_id matches snapshot   ✓/✗
```

“Ready” means path 3 **can** run, not that it already has.

---

## Diagnostics

Employee-generated, local, sendable. Checklist: Identity, Device, Org membership, Agent pairing, Org boundary, Employee policy, Credential **presence** (id/provider only), Broker (reachable, not the token), Provider resolution, Authentication (HTTP status, e.g. GitHub 401). Never PAT, password, RK, shares.

---

## Definition of done (Trusted Team)

All of these, **tested**:

Organization, invite, enrolment; employee-owned vault; admin cannot decrypt; devices; org-revoke; agent identity + pairing; resources; boundary; employee agent policy; Effective Access; sealed backup + restore; XOR 2-of-2; Share A / Share B; ceremony on the **employee** device; admin can help without seeing plaintext; diagnostics; org audit; security tests; **solo kit and local profile still work**.

---

## Security principles (non-negotiable)

1. Admin must not decrypt an employee vault.
2. Server must not see plaintext, RK, or reconstructed RK.
3. Combine shares only on the employee device.
4. RK is the existing Recovery Key, not VK, not a new wrap layer.
5. 2-of-2 MVP is XOR; Shamir is later k-of-n.
6. Device identity reuses `device_id` / WebAuthn.
7. Loopback broker stays local; not a central secret server.
8. Origin 403 stays.
9. Do not bypass `packages/crypto` open-path expectations.
10. New objects are versioned.
11. Revoke applies to new access; copies already given are not un-known.
12. Grant TTLs stay.
13. Dual control is real: no full kit left with the employee after team split.
14. When extra admin control fights employee autonomy + ZK, choose the latter unless a necessary org function disappears.

---

**Stand:** 23. August 2026, rev. 2  
**Implementation:** none  
**Next:** maintainer names a slice — or “not now, stay on Autofill.”
