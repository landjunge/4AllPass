# Team Mode — Architecture Review and Phase-1 Spec

**Status:** Review only. **Not implemented.** No code in this document is a license to start building.  
**Date:** 2026-08-23  
**Companion:** [`team-roadmap.md`](team-roadmap.md), [`security-boundary.md`](security-boundary.md), [`crypto-protocol.md`](crypto-protocol.md), [`recovery.md`](recovery.md), [`local-access-broker.md`](local-access-broker.md), [`threat-model.md`](threat-model.md), [`product-maturity.md`](product-maturity.md)

This document is the answer to: *what would a 3–5 person Trusted Team layer look like on the existing 4AllPass, without turning it into PAM?*

P0/P1 (Install, Import, Autofill) stay the product sequence. Team Mode does not jump the queue. After this review we wait for an explicit decision.

---

## 0. Decision recorded here

**Do not implement yet.**

If a later PR “just adds organizations”, it is out of scope until this spec is accepted slice by slice.

The north star is **not**:

```text
Admin → Policy → Employee → Agent → Credential
```

That is PAM. 4AllPass must not become that.

The north star is:

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

Verbal form: *Trust the employee. Help when needed. Control the organization, not the person.*

Technical form:

- Organization controls the **boundary**.
- Employee owns the **vault**.
- Employee manages their **agents**.
- 4AllPass enforces the **intersection**.

```text
EffectiveAccess =
  OrganizationBoundary
  AND EmployeePolicy
  AND AgentPolicy
```

Either side can deny. Neither side can force the other to allow. An org “allow” is a **ceiling**, not an order to use the resource.

---

## 1. Repository architecture review

4AllPass is already one product: a **device-centric zero-knowledge password manager** with an optional local access broker. There is **no** Organization, Member, Resource, or Team table in the tree.

| Layer | Path | What it is today |
|---|---|---|
| Crypto protocol | `packages/crypto` | Argon2id, AES-256-GCM, Key Envelopes (master / device / recovery), sealed snapshot manifest, `vaultKeyVersion` |
| WebAuthn | `packages/webauthn` | PRF > largeBlob > UV-gated store → DWK → DK → VK. Server never sees PRF |
| Policy / grants | `packages/core` | `evaluatePolicy` / `decideAccess` / `issueGrant`. Application is a **string**. Unknown app = DENY. Grant has **no secret** |
| Access client | `packages/access` | Loopback-only HTTP client. Pairing token. No FastAPI |
| Broker (dev) | `packages/broker` | Node `:8787`. Queue only. **Not** the product path |
| Broker (product) | `backend/app/broker.py` | Sidecar relay on `127.0.0.1:8788`. Origin 403 on grant path |
| Providers | `packages/providers` | Domain ≠ provider. Confidence. Not an org catalog |
| Storage API | `backend/` FastAPI | Accounts, vault ownership (`get_owned_vault` → 404), snapshot CAS, opaque blobs |
| Models | `backend/app/models/` | `User`, `Vault`, `Device`, `VaultSnapshot`, `KeyEnvelope`, `EncryptedEntry`, `WebAuthnCredential` |
| Desktop | `src-tauri/` + same frontend | Tauri WKWebView. Unlock = master password. PRF in webview **unproven** |
| UI | `frontend/` | Tabs: Entries, Access, Devices, Settings. No Team tab |
| Recovery | Emergency Kit + Recovery Envelope | No server reset. Share file is a **new** VK, not a backup of the same vault |
| Audit | `packages/core` `auditLine` | Local access rows (application / provider / scope / decision). **No** org events. Secrets must not appear |

Two run profiles already exist and must stay distinct:

| Profile | How | Identity |
|---|---|---|
| **Local / solo** (`python -m app.local`, `npm run app`) | SQLite in Application Support. Loopback only | Singleton `local@127.0.0.1`. No email. One person, one machine |
| **Server** | FastAPI + SQLite or Postgres | Email + account password. Many `User` rows. Each user owns their vaults. Still never decrypts |

Team Mode **cannot** live inside the local singleton without breaking it. The smallest honest host for org metadata is the **existing server profile**, plus desktop apps that point at that URL. Solo local remains the default when no team URL is set.

---

## 2. Existing security-boundary map

Authoritative: [`security-boundary.md`](security-boundary.md). The three proofs must not be mixed, including for Team Mode.

| Proof | Question | Mechanism today | Team Mode may |
|---|---|---|---|
| Authentication | This is account X | Email + account password → Bearer; local bootstrap has no email | Add invite-accept that mints a **storage** session. Never unwraps VK |
| Authorization | Account X owns vault Y | `get_owned_vault` → foreign ids **404** | Keep. Org membership ≠ vault ownership. Admin 404 on employee vaults |
| Crypto | Snapshot authentic; only authorized client decrypts | Client AES-GCM, envelopes, sealed manifest | **Unchanged.** No org envelope. No admin wrapping key |

Server must never receive or derive: Master Password, VK, DK, DWK, PRF, plaintext entries, employee agent private keys, employee agent policy plaintext (unless the employee later opts into sharing a **redacted** diagnostic).

Honest limits that Team Mode inherits (do not “fix” them by weakening ZK):

1. `X-Device-Id` is **client-asserted**, not a WebAuthn proof. Org “this device belongs to member X” is the same class of metadata.
2. `DELETE /devices/{id}` is `metadata_only`. Soft revoke = next snapshot omits the device envelope. Hard revoke = employee `hardRevokeDevice` (`vaultKeyVersion++`).
3. Account session ≠ vault unlock.
4. FastAPI has **no** `/v1/access` token mint. Broker is local.
5. Application identity is a string (`n8n`) — spoofable. Pairing token is channel auth, not OS identity.
6. PRF is unproven in the Tauri webview. Team device unlock is still master password / recovery key.
7. A grant already handed to an agent cannot be un-known. TTL stops **future** handoffs.

---

## 3. Existing identity map

```text
Account (User)
  email / local singleton
  account password hash (server profile only)
        │
        │ owns (authorization, not crypto)
        ▼
      Vault
        random VK, sealed snapshots
        │
        ├── Master Envelope     (Argon2id → MK → VK)
        ├── Recovery Envelope   (printed kit → RWK → VK)
        └── Device Envelope[]   (DK → VK)
                │
                Device.device_id   (stable string, AAD-bound)
                localStorage `4allpass.deviceId`  (`frontend/src/lib/device-identity.ts`)
                optional WebAuthn credential (PRF → DWK → DK)
```

**What a Device is today**

- Stable string `device_id` chosen by the client (`dev_` + random hex).
- Bound into Device Envelope AAD and DWK HKDF info.
- Server row: `vault_id` + `device_id`, display name, platform, `revoked_at`.
- Not a hardware TPM quote. Not an org principal. One vault, many devices.

**What an Agent is today**

```text
application: "n8n"          // string, TRUSTED_APPLICATIONS = ["n8n"]
Authorization: Bearer <pairing token>   // printed, compare_digest, not a vault key
Origin: http(s)://… on POST /v1/access/request  → 403
```

A foreign process can claim `"application": "n8n"` if it has the pairing token. The token is the only real gate on the wire. Policy still DENYs unknown **names**, but the name is not cryptographic.

**What does not exist**

- Organization, Member, Invite, OrgDevice, Resource
- Agent keypair
- Org boundary policy
- Employee agent policy object (capabilities live on **credential entries** as strings)
- Org audit chain

---

## 4. Existing broker map

```text
n8n / @4allpass/access
        │  POST http://127.0.0.1:8788/v1/access/request
        │  Bearer pairing token
        │  no Origin (browser Origin → 403)
        ▼
backend/app/broker.py     // relay only
        │  queue → UI poll GET /v1/broker/poll
        │  UI POST /v1/broker/decide  { id, body }
        ▼
unlocked frontend
        decideAccess() in @4allpass/core
        unknown app DENY
        missing scope DENY
        decision "allow" = eligible for HUMAN Allow  (not auto-handoff)
        issueGrant() — metadata, no secret
        UI attaches material from the unlocked vault
        auditLine() — no secret
```

Rules that Team Mode must keep:

| Rule | Keep |
|---|---|
| Bind `127.0.0.1` | yes |
| Browser Origin on grant path = 403 | yes |
| Pairing token required | yes (channel). Agent pubkey is **identity**, not a replacement for loopback |
| FastAPI never decrypts, never mints provider tokens | yes |
| Policy in the unlocked UI, not in the sidecar | yes |
| Core grant has no secret | yes |
| Node `:8787` is not the product broker | yes |
| Unknown app DENY | yes |
| Human Allow still required for handoff | yes in Phase 1 (no silent agent grants) |

Do **not** move the broker onto the org server. Do **not** make FastAPI a credential broker. Do **not** index employee agent policies on the org server as plaintext.

---

## 5. Existing backup / recovery map

### Backup (already, under other names)

| Mechanism | What it is | Plaintext? | Same vault? |
|---|---|---|---|
| Active sealed snapshot on the server | Opaque envelopes + entries + sealed manifest | no | yes |
| Offline wire-snapshot cache (IndexedDB) | Last **verified** snapshot, pin still applies | no | yes |
| `4allpass-share-v1` file | New random VK, subset of entries, recovery-encoded share key | no | **no** — copy, new vault on import |
| Emergency Kit | 256-bit recovery key, printed. Unwraps Recovery Envelope | key is the secret | yes |

There is **no** separate “encrypted backup format” besides the snapshot. Do not invent one. A Team MVP backup is: **export the opaque wire snapshot** (same bytes the server already stores) plus the employee still holds master password and/or kit.

Restore of the **same** vault: fetch or import that snapshot, unlock with master or recovery key, enrol a new device envelope. That path exists in the crypto library (`verifySnapshot` / `unwrapVaultKey`). The local first-run “I have a vault” UI currently opens a **share** file and creates a **new** vault — that is not same-vault restore. Same-vault restore from kit + snapshot is the crypto path; the desktop UI for “download my sealed snapshot” is thin.

### Recovery (authoritative: [`recovery.md`](recovery.md))

The only cryptographic ways back into a vault:

1. Master password → Master Envelope → VK
2. Recovery key → Recovery Envelope → VK
3. Enrolled device with DK still available → Device Envelope → VK

There is **no** e-mail reset, **no** OAuth unwrap, **no** server-held recovery secret.

### What “admin helps recovery” can mean without breaking ZK

| Employee still has | Admin can | Admin cannot |
|---|---|---|
| Master password, lost laptop | Org-revoke the old device; employee unlocks on a new device from the snapshot | See VK or entries |
| Recovery kit, forgot master | Same org-revoke; employee uses kit locally | Hold or type the kit |
| Second enrolled device | Employee unlocks there; optionally hard-rotates | Rotate VK for them |
| Nothing (no kit, no master, no other device) | Sympathy and offboarding | Recover the vault. **Period.** |

If we cannot recover cryptographically, we **document the gap**. We do **not** introduce an admin unwrap key, a server-held escrow, or a “break glass” copy of VK.

Phase-2+ options (not MVP): Shamir (employee share + optional admin share, admin share **alone** cannot unwrap); public-key wrapping to a **new** device after the employee already unwrapped VK. Both need new primitives. Not now.

---

## 6. Gap analysis

| Object | EXISTING | REUSE | MODIFY | NEW | DEPRECATED |
|---|---|---|---|---|---|
| Vault / VK / envelopes / manifest | yes | **must** | no protocol change | — | — |
| User + vault ownership 404 | yes | org ≠ owner | none for solo | Member links `user_id` | — |
| `device_id` + Device Envelope | yes | bind org row to **same** string | org-revoke is a **separate** flag | `OrgDevice` | do not invent a second device id |
| WebAuthn / PRF | yes, unproven in Tauri | enrol as today | none | — | do not add a Tauri-biometrics envelope |
| Agent string + pairing token | yes | keep token as **channel** | `evaluatePolicy` grows AND-layers | Agent keypair (WebCrypto, not `packages/crypto`) | string-only identity becomes insufficient **when Team is on**; solo may keep string until pairing upgrade |
| Credential capabilities on entries | yes | employee policy can point at them | optional resource id on the policy, not on FastAPI entries | — | — |
| `evaluatePolicy` | employee-only | keep default solo path | add optional `orgBoundary` + `agentPolicy` AND | `effectiveAccess()` | do not replace with an admin PDP |
| Access audit | local, no secrets | employee diagnostics | do not ship rows to admin by default | org-event audit | do not log “opened GitHub at 14:32” for the org |
| Snapshot as backup | yes | export/import wire snapshot | UI for full-snapshot export | — | do not treat share-v1 as backup |
| Recovery kit | yes | only crypto recovery | recovery **assistance** UX (org device revoke + re-enrol) | honest “cannot recover” state | no admin recovery key |
| Local solo profile | yes | **unchanged** | hidden Team chrome unless a team URL exists | — | — |
| Server profile | yes | host org tables | new routes under `/api/v1/orgs` | Organization, Member, Invite, Resource, OrgBoundary, OrgAudit | — |
| Organization vault / shared secrets | no | leave room (member ≠ vault) | — | Phase 2 only | do not sneak it into Phase 1 |
| SSO / SCIM / LDAP / RBAC / HSM / JIT | no | — | — | Phase 3+ | — |
| PAM / session recording / admin credential view | must never exist | — | — | — | if a design looks like this, reject it |

---

## 7. Architecture conflicts (do not paper over)

1. **Solo local vs team host.** Local SQLite is one user. Org membership needs a shared server. Resolution: Team is opt-in; desktop setting `teamServerUrl`; empty = today’s app.
2. **Org device revoke ≠ vault hard-revoke.** Prompt example “Revoke MacBook → org access denied, vault still encrypted” is **org-layer**. Stolen-device **crypto** revoke remains the employee’s `hardRevokeDevice`. Admin cannot do VK++. UI must use different words: “Remove from organization” vs “Rotate vault key”.
3. **Agent string vs keypair.** `packages/crypto` has no signing primitive. Resolution: Ed25519 (or equivalent) via WebCrypto **in the access layer**, versioned `agent-identity-v1`. Do **not** add a second vault wrap protocol.
4. **Recovery vs “admin helps”.** Crypto cannot help if kit and master are gone. Resolution: assistance is operational. Document the dead end.
5. **Access audit vs surveillance.** Today’s `auditLine` is local agent Allow/Deny. If that stream is copied to the org, we have PAM. Resolution: org audit = membership/device/resource/recovery **events** only.
6. **Secret Access Layer note** (`secret-access-layer.md`): FastAPI should not index “n8n may read OpenAI”. Org **boundary** (Daniel may use AWS Production) is org metadata and may live on the server. Employee **agent policy** (this n8n may use AWS Staging) stays in the employee vault ciphertext. Do not collapse the two.
7. **`X-Device-Id` honesty.** OrgDevice is metadata. A stolen session + stolen device id can still talk to the org API until membership/device is revoked. It still cannot decrypt another vault.
8. **Default deny vs usability for 3–5 people.** Org resources start **deny** unless an admin allow-row exists. Personal vault entries that are **not** tagged as an org resource stay employee-only; org policy does not see them and must not need to.
9. **Human Allow.** Phase 1 keeps the existing Allow/Deny prompt. Team Mode does not auto-issue because the org allowed it.
10. **Sharing vs backup.** Share-v1 is the wrong restore primitive for a lost laptop (new VK). Do not tell admins to “send a share”.

---

## 8. Philosophy and trust model

### Who is trusted with what

| Actor | Trusted to | Not trusted to |
|---|---|---|
| Employee | Own vault, own agents, own policies, own devices in normal operation | Another employee’s vault |
| Admin | Org, members, invites, org devices, resources, org boundary, assistance, org audit | Employee plaintext, VK, master, kit, agent private keys, full agent policies |
| Org server (even if the admin operates it) | Store opaque vault blobs + org metadata | Decrypt. Mint provider tokens. See pairing private material |
| Agent | Speak to loopback after pairing; receive a TTL grant after human Allow | Claim a name; hold a durable org role; bypass employee deny |
| 4AllPass software | Enforce AND, diagnose without secrets, help recover operationally | Escrow keys “for convenience” |

### Trust the employee

The org does not pre-approve each agent. The org does not watch each credential use. The org sets which **company resources** a **person** may touch at most. The person decides which of their agents may use that ceiling.

### Help when needed

Lost laptop: admin org-revokes the device, employee restores from snapshot + master/kit, enrols a new device, org binds the new `device_id`. Diagnostics: employee generates a redacted report and can send it.

### Control the organization, not the person

Suspend/remove member, revoke org device, define company resources, set the boundary. Never “open Daniel’s GitHub”.

---

## 9. Proposed data model (Phase 1)

All new objects are **versioned**. Soft-delete via `status` / `revoked_at`. No plaintext secrets in any column.

### Organization

```text
Organization
  id
  name
  createdAt
  ownerUserId          // initial admin; still a User, not a crypto principal
  status               // active | suspended
  schemaVersion        // 1
```

### Member

```text
Member
  id
  organizationId
  userId               // same User that owns that person’s vaults
  role                 // admin | member     (only these in v1)
  status               // pending | active | suspended | removed
  createdAt
```

Roles in v1: **admin** and **member**. No custom RBAC.

### Invite

```text
Invite
  id
  organizationId
  email
  role
  tokenHash            // only hash at rest
  expiresAt
  createdByMemberId
  acceptedAt
```

Accept: create or link `User`, set Member `active`. Employee then creates **their own** vault if they do not have one. Invite does not wrap VK.

### OrgDevice

```text
OrgDevice
  id
  organizationId
  memberId
  deviceId             // SAME string as vault Device.device_id
  displayName
  status               // active | revoked
  enrolledAt
  revokedAt
```

Unique `(organizationId, deviceId)`. Org revoke sets `status=revoked`. It does **not** delete the Device Envelope. Employee vault on that laptop still decrypts if VK is there. Org APIs and EffectiveAccess treat the device as denied.

### Resource (company-owned **names**, not credentials)

```text
Resource
  id
  organizationId
  name                 // "AWS Production"
  provider             // "aws" | "github" | …  (catalog string, not a secret)
  status
  metadata             // non-secret JSON (account alias, region label)
  schemaVersion
```

Admin never sees which personal credential the employee stored for that name.

### OrganizationBoundary

```text
OrgBoundary
  id
  organizationId
  memberId
  resourceId
  effect               // allow | deny
  version              // monotonic per row
  updatedAt
```

Missing row = **deny** for that org resource. Personal (non-resource) vault items are out of this table.

### Employee-side (ciphertext, in the employee vault — not FastAPI columns)

```text
AgentIdentity v1
  version: 1
  type: "agent-identity-v1"
  id
  label                // "n8n" — display only
  publicKey            // WebCrypto signing key
  deviceId             // which employee device paired it
  status               // active | revoked
  createdAt

AgentPolicy v1
  version: 1
  type: "agent-policy-v1"
  agentId
  resourceId?          // org resource, if any
  provider?            // personal provider name
  capabilities[]
  effect               // allow | deny
```

These objects are vault entries or a sealed sidecar blob under the same VK. The org server stores **at most** `agentId` + `publicKey` if we later need org-wide revoke-of-a-stolen-agent — **Phase 1 default: do not upload them.** Stolen agent: employee revokes locally; org can still deny the **resource** or **member**.

### OrgAudit (server, no secrets)

```text
OrgAudit
  id
  organizationId
  type                 // see §16
  actorMemberId
  targetType           // member | device | resource | invite | recovery
  targetId
  at
  prevHash             // SHA-256 of previous row in this org (tamper-evident, not a transparency log)
  rowHash
```

Event types in Phase 1:

- `member.invited` `member.joined` `member.suspended` `member.removed`
- `device.enrolled` `device.revoked`
- `resource.created` `resource.changed`
- `recovery.started` `recovery.completed` (operational flags, no keys)

**Not** in Phase 1: `credential.accessed`, `agent.granted`, per-request trails for the admin.

### Unchanged

`User`, `Vault`, `VaultSnapshot`, `KeyEnvelope`, `EncryptedEntry`, `Device` (vault), `WebAuthnCredential`. No `organization_id` on `Vault`. That would invite “admin lists employee vaults”.

---

## 10. Effective access

```text
request from Agent A, Member M, Device D, Resource R, capability C

1. Member M status == active?                         else DENY member_inactive
2. OrgDevice D status == active for M?                else DENY device_revoked
3. R is an org resource?
     yes → OrgBoundary(M, R) == allow?                else DENY org_boundary
     no  → org layer skips (personal credential)
4. Agent A identity verifies (signature + not revoked)
5. Employee AgentPolicy(A, R or provider, C) == allow
6. Existing evaluatePolicy on the vault credential
     (unknown app DENY, scope, revoked credential, …)
7. Human Allow in the unlocked UI
8. Grant TTL as today
```

AND all the way down. Examples from the prompt:

| Org | Employee | Result |
|---|---|---|
| Daniel → AWS Prod allow | n8n → AWS Prod deny | DENY |
| Daniel → AWS Prod deny | n8n → AWS Prod allow | DENY |
| allow | allow | eligible for human Allow |

Organization allow is **not** an instruction to the employee to use AWS Production.

TTL: keep `issueGrant` / `grantIsValid`. Expired grant fails. Revoked device / member / agent fails **new** grants; copies already given are not un-known (same honesty as today).

---

## 11. Proposed API changes

Prefix: `/api/v1/orgs`. Server profile only. Local profile: 404, same as `/auth/local` inverted.

All routes: Bearer session + `X-Device-Id`. Org routes additionally: caller is an **active** member (admin-only where noted). Foreign org ids → **404**, never 403 (same honesty as vaults).

**Never accepted on these routes:** master password, VK, DK, DWK, PRF, recovery key, entry plaintext, agent private key, employee policy blob.

| Method | Path | Who | Effect |
|---|---|---|---|
| POST | `/orgs` | any authenticated user | create org, caller becomes admin member |
| GET | `/orgs/{id}` | member | metadata |
| POST | `/orgs/{id}/invites` | admin | invite email + role |
| POST | `/orgs/invites/{token}/accept` | invited user | member → active |
| POST | `/orgs/{id}/members/{mid}/suspend` | admin | status suspended |
| POST | `/orgs/{id}/members/{mid}/remove` | admin | status removed |
| POST | `/orgs/{id}/devices` | member (self) | bind this `deviceId` |
| POST | `/orgs/{id}/devices/{did}/revoke` | admin | org-revoke |
| CRUD | `/orgs/{id}/resources` | admin | company resources |
| PUT | `/orgs/{id}/boundaries/{memberId}/{resourceId}` | admin | allow \| deny |
| GET | `/orgs/{id}/boundaries/me` | member | **own** ceiling only |
| GET | `/orgs/{id}/audit` | admin | org events |
| POST | `/orgs/{id}/recovery/start` | admin or member | flag + audit; **no keys** |
| POST | `/orgs/{id}/recovery/complete` | member | flag + audit |

**Not added:**

- `GET /orgs/{id}/vaults`
- `GET /orgs/{id}/members/{mid}/entries`
- `POST /v1/access` on FastAPI
- admin read of agent policies
- JIT credential issue

Existing `/api/v1/vaults/*` stays owner-only. An admin who is not the owner still gets 404.

Broker routes stay on loopback. Optional later: request body may include `agentSignature` + `agentId`; UI verifies before `evaluatePolicy`. FastAPI still not in that path.

---

## 12. Proposed UI changes (existing Tauri/PWA, no second app)

4AllPass is not a desktop-browser-first team console. Team Mode is extra chrome in the **same** app. Solo: no Team tab.

Tabs today: `entries | access | devices | settings`.

**Employee (member, including admins in their personal role):**

```text
My Vault          (today’s entries — default)
My Devices
My Agents         (pairing, revoke agent, was Access)
Agent Policies
Organization      (name, my status, my ceiling — not other people)
Backup            (export sealed snapshot)
Recovery          (kit reminder, new-device enrol)
Diagnostics
```

Access/Allow-Deny stays the grant UX, not the first screen (`product-maturity.md`).

**Admin (additional):**

```text
Team
  Members
  Devices         (org device list — display names, not vault envelopes)
  Resources
  Boundaries      (member × resource allow/deny)
  Recovery        (start assistance — revoke old org device, cannot unwrap)
  Diagnostics     (receive a redacted report the employee generated)
  Audit           (org events)
```

Admin UI and employee UI differ **only** where responsibility differs. An admin still has a personal vault tab. They do not get a “view member vault” control, including disabled-and-greyed. Absence, not a tease.

Copy rules (DE+EN): never say “Admin can restore your passwords”. Say “Admin can remove the old device from the organization. Only you can unlock the vault.”

---

## 13. Threat model (additions)

Existing [`threat-model.md`](threat-model.md) still applies. New actors and goals:

### New assets

| Asset | Sensitivity | Where |
|---|---|---|
| Org membership / boundary rows | Medium (infra map, not passwords) | Server |
| Invite token | Medium | Hash at rest; raw only in the invite channel |
| Agent private key | High | Employee device, never server |
| Employee agent policy | Medium-high (which tools may touch which company systems) | Employee vault ciphertext |
| Org audit chain | Low-medium | Server |

### New actors

| Actor | Can | Cannot |
|---|---|---|
| Org admin (honest) | Invite, suspend, org-revoke devices, set ceiling, read org audit | Decrypt employee vaults |
| Org admin (malicious / same as self-hosted operator) | Everything a malicious server can already do to **blobs**; rewrite org metadata; withhold snapshots | Forge envelopes under VK; read plaintext without Argon2id / kit / unlocked client |
| Employee malware | Same as today’s unlocked client | Other employees’ VK |
| Fake agent (`application: "n8n"` without key) | Today: succeed if pairing token stolen. Phase 1 goal: fail signature |
| Removed employee with old snapshot | Decrypt **their** historical ciphertext they already hold; cannot use org APIs | New org resources; other vaults |

### Goals Team Mode must not regress

- Full server dump still does not yield plaintext.
- Admin session ≠ employee VK.
- Org deny cannot be overridden by employee allow.
- Employee deny cannot be overridden by org allow.
- Revoked org device cannot pass step 2 of EffectiveAccess.
- Removed member cannot pass step 1.
- Diagnostics and org audit contain no secret, no password prefix, no recovery key.

### New residual risks (accepted in Phase 1)

- Org metadata reveals that “Daniel is allowed AWS Production”. That is the point of a boundary, not a defect. It is **not** Daniel’s password.
- OrgDevice binding is as strong as `X-Device-Id` (client-asserted).
- Admin can **availability-DoS** an employee’s org access (suspend). That is an org power. They still cannot open the vault.
- First-use snapshot choice (malicious server) remains; Team does not fix pin-on-first-use.

---

## 14. Backup, recovery, diagnostics, audit (Phase-1 behaviour)

### Backup

Employee action: **Download sealed snapshot** (wire format already produced by `encodeVaultSnapshot`). File contains envelopes + ciphertext + sealed manifest. Integrity = existing `verifySnapshotManifest`. `vaultKeyVersion` rides along. No plaintext.

Restore: open file or fetch from server, unlock with master or kit, enrol this device. Tests: file grep/scan must not contain known plaintext passwords.

Do not store backups in an admin inbox.

### Recovery (operational)

Flow for “laptop dead”:

1. Employee (or admin with employee’s request) starts recovery → org audit `recovery.started`.
2. Admin org-revokes the old `deviceId`.
3. Employee on a new device: account login / invite still valid, fetch snapshot, unlock with master or kit, enrol new device, bind OrgDevice.
4. If the old laptop may have been stolen **and** may hold VK: employee runs **hard revoke** (their master/kit). Admin cannot.
5. `recovery.completed`.

If unlock is impossible: UI states that 4AllPass cannot restore the vault. Offboard the member. Do not mint a replacement vault from org data.

### Diagnostics

Employee-generated, local, no secrets. Checklist:

| Check | Source |
|---|---|
| Identity | session / member status |
| Device | OrgDevice status + local `deviceId` |
| Organization membership | member status |
| Agent pairing | local AgentIdentity |
| Organization boundary | `/boundaries/me` |
| Employee policy | local AgentPolicy |
| Credential availability | vault entry exists (id / provider only) |
| Broker | loopback reachable, pairing token present (not printed in the report) |
| Provider | `@4allpass/providers` resolution |
| Authentication | e.g. GitHub 401 — **status code**, not the token |

Example line: `Authentication ✗  Provider GitHub  HTTP 401`. Never the PAT.

The employee **may** send this report to admin. Default is local-only.

### Audit

Org events only (§9). Hash-chain per organization (`prevHash`) is enough tamper-evidence for a 3–5 person host. Not a transparency log, not signed by `packages/crypto` VK (the org server would need a key that is **not** a vault key — skip signatures in v1 rather than invent a new org signing identity). Revisit in Phase 3.

Local `auditLine` stays on the employee device.

---

## 15. MVP implementation plan (when unblocked)

Do **not** start until the maintainer says which slices. Suggested order; each slice is a PR with tests; crypto package stays frozen unless a later decision says otherwise.

| Slice | What | Why this order |
|---|---|---|
| 0 | This review (done) | No parallel security architecture |
| 1 | Organization + Member + Invite on **server profile**. Solo local untouched | Smallest org primitive |
| 2 | OrgDevice bind + org-revoke. Copy: not vault hard-revoke | Reuses `device_id` |
| 3 | Resources + OrgBoundary. Default deny. `/boundaries/me` | Ceiling without seeing credentials |
| 4 | `effectiveAccess` in `@4allpass/core`: AND org + employee + existing policy. Solo path if org context absent | One policy function, two modes |
| 5 | Employee AgentPolicy stored in vault ciphertext. UI for the employee. Admin cannot GET it | Autonomy |
| 6 | Agent identity v1 (WebCrypto keypair, challenge/response pairing). Broker still loopback. Fake name fails | Stronger than string+token |
| 7 | Sealed-snapshot export/import UI (same-vault). Tests: no plaintext in file | Backup without new crypto |
| 8 | Recovery assistance UX + honest dead-end | Help without escrow |
| 9 | Diagnostics report (no secrets) | Support |
| 10 | OrgAudit hash-chain + admin list | Org events, not surveillance |
| 11 | Admin/Employee chrome in the existing app | One product |
| 12 | Adversarial tests from §18 | DoD |

Stop after the smallest slice that a real 3–5 person group can use: 1–5 + 7–8 + 10–12 is already a team. Slice 6 (agent keypair) is in the written DoD — include it before calling the MVP done, but **after** org/member works, so we do not invent identity in a vacuum.

**Out of this MVP:** SSO, SCIM, LDAP, custom roles, PAM, central credential broker, HSM, compliance packs, standing agent surveillance, admin vault access, Organization Vault, JIT issuing.

---

## 16. Places the existing architecture would have to change

| Place | Change | Risk if done wrong |
|---|---|---|
| `backend/app/models/` + Alembic | New org tables | Putting `organization_id` on `Vault` or allowing admin `get_owned_vault` |
| `backend/app/api/routes/` | New `orgs.py` | Mounting access/grant on FastAPI |
| `backend/app/local.py` | Keep 404 for org routes | Accidentally enabling team on the singleton |
| `packages/core` policy | Optional AND-layers | Replacing unknown-app DENY; auto-allow when org allows |
| `packages/core` audit types | Org event types **separate** from access audit | Shipping access rows to admin |
| `frontend` tabs / new panels | Team vs personal | Access as first screen; “view member vault” |
| `frontend/src/lib/access.ts` | Pass org ceiling + agent signature into decide | Broker starts evaluating policy |
| `frontend/src/lib/device-identity.ts` | Reuse, register with org | Second device id |
| `frontend` vault-session | Snapshot export | Using share-v1 as backup |
| `backend/app/broker.py` | Optional signature field on the **relayed body** only | Broker verifies crypto or stores keys |
| `packages/crypto` | **No change** for Phase 1 | “Org envelope”, admin wrap, new KDF |
| Tests | New classes below | Claiming team is done without boundary tests |

---

## 17. Risks and open questions

**Decided in this review (unless the maintainer overrules):**

- No admin recovery key.
- No org vault in Phase 1.
- No PAM audit of credential use.
- OrgDevice uses the existing `device_id`.
- Broker stays loopback.
- `packages/crypto` frozen for Phase 1.
- Solo local unchanged.

**Open — need a human decision before code:**

1. **When?** Team is specified; product-maturity still has P0→P1 Autofill as next **code**. Recommendation: keep that order. Team docs exist so a future slice does not invent PAM.
2. **Where does the 3–5 person server run?** One shared FastAPI (SQLite is enough). Not P2P. Not each desktop pretending to be the org.
3. **Invite channel?** Email send is ops. MVP can show a copy-paste invite URL in the admin UI (like the pairing token). No mail provider required.
4. **Should agent public keys be uploaded?** Default no. Org revoke of an agent then requires employee action or member/resource deny. Uploading only `agentId`+`publicKey` is a Phase-2 discussion.
5. **Must every org resource map 1:1 to `@4allpass/providers`?** Start with a name + provider string. Do not wait for 500 providers.
6. **Shamir for “admin helps when kit is lost”?** Not Phase 1. If ever: admin share alone must fail a test.
7. **Public-key wrap to a foreign device** (needed for true org vault later) does not exist. Phase 2 must not fake it with symmetric share files presented as “the org vault”.
8. **PRF still unproven in Tauri.** Team must not claim passkey-bound org devices until a ceremony returns PRF.

---

## 18. Tests the MVP must add (before calling it done)

Minimum; names are intent, not filenames.

- Admin cannot decrypt employee vault (404 on vault routes + ciphertext remains closed).
- Employee cannot access another employee vault.
- Revoked org device cannot pass EffectiveAccess.
- Removed employee cannot call org APIs.
- Revoked agent cannot request grants.
- Fake agent identity (name only / wrong signature) fails.
- Org deny overrides employee allow.
- Employee deny overrides org allow.
- Valid org + employee policy + existing credential policy → pending human Allow.
- Expired grant fails.
- Old revoked org-device state fails (replay of pre-revoke bind).
- Backup file contains no plaintext.
- Backup restore (same vault) works with master and with recovery key.
- Recovery assistance does not put VK or kit on the admin API.
- Diagnostics contain no secrets (reuse `auditContainsSecret` idea).
- Audit records org events, not `credential.accessed`.
- Solo local profile: no org routes, existing crypto tests green, Access string identity still works when team context is absent.

Existing `packages/crypto` tests stay green. No protocol version bump unless crypto actually changes (it should not).

---

## 19. Definition of done (Trusted Team MVP)

From the product brief; all must be true **and** tested:

1. Admin can create an Organization.
2. Admin can invite a member.
3. Member can accept.
4. Member has their own vault.
5. Admin cannot decrypt that vault.
6. Member can have several devices.
7. Admin can org-revoke a lost device.
8. Agent has a cryptographic identity.
9. Agent pairing works (challenge/response, loopback intact).
10. Employee can set their agent policy.
11. Admin can define organization resources.
12. Org boundary AND employee policy = Effective Access.
13. Encrypted backup works (sealed snapshot).
14. Restore works.
15. Lost-device recovery works **without** giving vault plaintext to admin. If kit and master are both gone, the product says so instead of lying.
16. Diagnostics locate typical agent failures without secrets.
17. Audit records organizational events.
18. Solo mode unchanged.
19. Existing crypto tests green.
20. New tests cover the team boundaries above.

---

## 20. Security principles (non-negotiable)

1. Admin must not decrypt an employee vault.
2. Organization server must not see plaintext secrets.
3. Agent identity must be stronger than string + bearer pairing token **when Team is on**.
4. Device identity reuses WebAuthn/PRF binding; no second identity system.
5. Loopback broker stays local.
6. Broker must not become a central secret broker.
7. Browser Origin protection stays.
8. Do not bypass `packages/crypto` boundaries.
9. No new parallel vault primitives without necessity.
10. New security objects are versionable.
11. Revoke applies to old grants / old device states for **new** access.
12. TTLs remain on agent grants.
13. Zero-knowledge is not traded for convenience.
14. When choosing extra admin control vs employee autonomy + ZK, choose the latter unless a necessary org function disappears.

---

## 21. Future extensions

See [`team-roadmap.md`](team-roadmap.md). Phase 1 must not implement them. It must not make them impossible:

- Organization-owned vault / shared credentials / key envelopes / rotation / ownership transfer (Phase 2) — needs public-key wrapping, which does not exist yet.
- Optional enterprise (SSO, SCIM, LDAP, richer roles) (Phase 3).
- Stronger machine identity (OS code signing, hardware-backed agent keys) (Phase 4).

A Phase-1 schema that puts `organization_id` on `Vault` or stores employee agent policies in plaintext on the server **would** make Phase 2 harder and Phase 1 already PAM. Do not do that.

---

**Stand:** 23. August 2026  
**Implementation:** none  
**Next step:** maintainer decision. Not “weiter, bau Team Mode”.
