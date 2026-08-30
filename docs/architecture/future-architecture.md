# 4AllPass — Future architecture (2026–2030+)

**Status:** Vision and reality check. **Not implemented.** Not a promise.  
**Date:** 2026-08-28  
**What runs today:** [`../security-boundary.md`](../security-boundary.md). This file must not contradict it.  
**Code sequence (now):** [`../product-maturity.md`](../product-maturity.md) **v3**.  
**Check for later PRs:** [`future-compatibility-check.md`](future-compatibility-check.md)

> 4AllPass is a local-first, zero-knowledge trust fabric for humans, devices, agents, organizations and digital assets. It enables cryptographically verifiable relationships, scoped capabilities and proofs without requiring a central party to possess the underlying secrets.

> **4AllPass MUST NOT assume that a principal is human, that a credential is a password, that a device is trusted because it is connected, or that a vault must contain all credentials of its owner.**

Standing rules (docs, not a license to implement):

1. The server stores the vault. The client owns the vault. ([`../vault-storage.md`](../vault-storage.md), [`../vault-protocol.md`](../vault-protocol.md))
2. Agents receive capabilities, not the vault. **Today** that is still a raw-secret handoff after human Allow ([`../security-boundary.md`](../security-boundary.md) §7, [`agent-access.md`](agent-access.md)).
3. Identity is shared. Authorization stays local. ([`../specs/maip-v0.1.md`](../specs/maip-v0.1.md))
4. Small core, strict guarantees, optional extensions.

Map: [`../security-boundary.md`](../security-boundary.md). **Do not implement this file.** Code sequence remains [`../product-maturity.md`](../product-maturity.md) v3. Index: [`../README.md`](../README.md).

The password manager is the **entry**. It is also what we ship in 2026. A half-built fabric is worse than an excellent vault.

**Store less. Prove more.** Do not invent a proprietary identity standard if W3C VC / OpenID4VP / EUDI already fit. 4AllPass knows no Tollgate policies; Tollgate knows no vault contents.

---

## NOW / NEXT / LATER / RESEARCH

| Bucket | Meaning |
|---|---|
| **NOW** | Locked v3: Install → Import → Autofill. Stranger-Mac import. No Connection rebuild. |
| **NEXT** | Multi-device foundation that does **not** rewrite `packages/crypto`. |
| **LATER** | Vault federation, agent public keys, mobile **app**, passkey **store**, Team Mode (review already: [`../team-mode.md`](../team-mode.md)). |
| **RESEARCH** | Proofs, eIDAS, robots, TEE, biological identity. DNA is **never** a wrapping secret. |

---

## What the code actually is (2026-08-28)

Authoritative running system: [`../security-boundary.md`](../security-boundary.md). Snapshot:

```text
packages/crypto     Protocol v1. Random VK. Envelopes. Sealed manifest.
packages/core       Policy sees Credential {id, provider, label, account, capabilities[]}
                    — no password field. AccessRequest.application is a string.
backend           Opaque snapshots. Ownership 404. FastAPI mints no vault tokens.
frontend VaultEntry kind: web | api | sftp; always has username + password + totpSecret
extension           Fill from unlocked snapshot. Pull newer revision. No Chrome write-back.
Desktop Tauri
  bundled frontendDist
  ↓
loopback API sidecar
127.0.0.1:8788

Remote localhost content has no Tauri IPC capability.

Access broker       Loopback, Origin 403, unknown DENY, human Allow,
                    handoff: "raw_secret". TTL stops later handoffs, not a copied secret.
Share file          New vault id + new VK + recovery envelope. Symmetric. Not live federation.
```

Honest one-liner: **one random Vault Key wraps all entries; devices unwrap that key; the server stores blobs; agents are named strings; Allow still copies a raw secret.**

---

## Reality check (code vs vision)

GREEN = already points this way. YELLOW = refactor, no new protocol. RED = needs a protocol/design change. For RED: what would have to change **today** if we started that work (we are not starting it).

### GREEN

| Vision | Why the current design already allows it |
|---|---|
| Vault = cryptographic domain | Random VK, master/device/recovery envelopes, `vaultKeyVersion`. Backend `Vault` row is metadata + snapshot pointer, not plaintext. |
| Device is cryptographic | Device envelope presence is access. Soft revoke drops envelope; hard revoke is VK++. `DELETE /devices` is `metadata_only`. |
| Server never sees secrets | FastAPI schemas reject key material. Sidecar is the same rule. |
| Crypto agility (symmetric) | `cryptoVersion` / `schemaVersion` / `vaultKeyVersion` are mandatory; versions are never defaulted ([`../crypto-protocol.md`](../crypto-protocol.md) §1). |
| Post-quantum **honesty** | v1 wrapping is AES-256-GCM. No fake “PQ” sticker. Hybrid KEM only if public-key wrapping exists ([`../post-quantum-roadmap.md`](../post-quantum-roadmap.md)). |
| Policy without passwords | `@4allpass/core` `Credential` has no secret field. After Allow, v1 still attaches `handoff: "raw_secret"`. TTL does not un-know a copy. |
| Share = new domain | [`../sharing.md`](../sharing.md) already mints a **new** vault id and **new** VK. That is federation-shaped, one-shot. |
| Mobile protocol | Crypto spec already says future Mobile must follow v1. Format is not Tauri-specific. |
| Unknown agent DENY | `TRUSTED_APPLICATIONS = ["n8n"]`. Unknown = DENY. |
| Loopback trust | UI is bundled `frontendDist`. Sidecar `127.0.0.1:8788` is API-only. Remote localhost has no Tauri IPC. Occupied 8788 refuses to start. |

### YELLOW

| Vision | What is coupled today | Later change (not now) |
|---|---|---|
| Credential ≠ password | `VaultEntry` always has `password`; `kind` is `web \| api \| sftp`; `capabilities` is a **string** | `ENTRY_SCHEMA_VERSION` bump; optional fields; keep `password` for web. Do not rename every call site in the autofill PR. |
| Provider intelligence | Host match + `@4allpass/providers` | Templates / login-flow metadata ([`../provider-service-vision.md`](../provider-service-vision.md) `#65`) — parked. |
| Agent as principal | `AccessRequest.application: string` | Add `principalType` + optional public key **beside** the string so n8n HTTP recipes keep working. |
| Partial / selective sync | Snapshot is the **whole** entry set under one VK | Per-item keys or wrapped subsets. Same VK can stay for “this device has everything”. |
| Multi-vault UX | Backend allows many vaults per user; local PWA is a **singleton** (`local@127.0.0.1`) | Spaces = extra vault rows + extra VK. No Core rewrite. |
| Mobile client | Crypto is JS/WASM-friendly; autofill is browser extension | iOS/Android Autofill APIs are new clients, not a new envelope format. 0 % app code now. |
| Audit → Proof | `AuditEvent` is local metadata, unsigned | Sign later; do not pretend logs are proofs. |

### RED (do not start)

| Vision | Why it does not fit v1 | Exact change required before code |
|---|---|---|
| **Live vault-to-vault connection** | Wrapping is **symmetric**. You cannot wrap VK to a foreign Device Key. | Public-key wrapping (new envelope `type`, new `cryptoVersion`, hybrid KEM per [`../post-quantum-roadmap.md`](../post-quantum-roadmap.md) §3). Discovery ≠ Trust ≠ Capability as **three** objects. Connection must not unwrap the peer VK. |
| **Selective live share of one item** | Entries share one VK. Anyone who unwraps VK reads **all** entries in that snapshot. | Item keys, or a derived per-item key wrapped by VK, **or** a fresh share vault (already exists). Live “Finance may read cards only” is item keys or a dedicated vault. |
| **Cryptographic agent identity** | Pairing token + string `n8n`. Spoofable by design ([`../security-boundary.md`](../security-boundary.md) §7). | Agent Device Key or signing key; host device attestation; still unknown=DENY. FastAPI still must not mint vault unwrap. |
| **Proof / document signatures** | No document hash, no signing key in the vault, no timestamp authority. | New item kind + hardware-backed sign. eIDAS qualified signatures = **trust service**, not this repo. |
| **Principal table (Human/Robot)** | Account is e-mail + account password (storage auth, not crypto). | Do not overload account e-mail. New client-side principal objects. Robots = LATER. |
| **Browser profile as Device** | Cards list OS profiles; import copies Login Data. Not an envelope. | Optional: enrol a browser profile as a device. Easy to get wrong (Chrome process ≠ Device Key). |
| **Bidirectional Chrome sync** | Product rule: never write `Login Data`. | Keep RED as **won't**. Extension fill is the write path. |
| **DNA as key** | Compromised DNA cannot rotate. | **BLOCK.** Biometrics may unlock a hardware key (WebAuthn). DNA is not HKDF input. |
| **Team as PAM** | [`../team-mode.md`](../team-mode.md): employee vault stays employee-owned. | XOR 2-of-2 of Recovery Key if Team is accepted. Admin never holds VK. |

**Over-sized for this repo (say it plainly):** Confidential computing, robot SKUs, qualified eIDAS, Coinbase-clone, government ID issuance. Architecture must not *forbid* a later principal type. It must not grow a second product to chase them.

---

## Vault federation (LATER — ADR only)

```text
DISCOVERY   "I know vault B."     (id + maybe a public wrapping key)
    ↓
TRUST       "I accept vault B."   (local policy, revocable)
    ↓
CAPABILITY  "B may use X for TTL" (never the whole VK)
```

A connection is **not** access. Today the closest object is a **share file** (new VK, chosen entries). That is one-shot, not a live link, not revocable after copy. Honest.

`VaultConnection` as a row on FastAPI that includes secrets would be a **BLOCK**.

---

## Credential model (do not rewrite now)

`VaultEntry` is a **wide JSON object** with `ENTRY_SCHEMA_VERSION`. That is enough to add `kind: "note"` or `passkey` later without a Core rewrite.

Do **not** replace it with a 12-type union in the autofill slice. Autofill and import need `username`/`password`/`url` to stay boring and tested.

`@4allpass/core` already separates **policy credential** (no secret) from **vault entry** (secret). Keep that split.

---

## Agents (NOW vs LATER)

NOW: string application, loopback broker, human Allow, `handoff: "raw_secret"`. TTL limits later handoffs, not a copied credential. Pairing token ≠ identity.

LATER: same `evaluatePolicy`, plus MAIP verify **first** ([`../specs/maip-v0.1.md`](../specs/maip-v0.1.md)). Do not replace the broker with MCP. MCP is not the security boundary ([`../capability-contract-v1.md`](../capability-contract-v1.md)). Headless / robot is that same later requester — not a robot SKU, not MHS-in-4AllPass, not a vault Device envelope as the agent’s papers ([`agent-access.md`](agent-access.md) § Headless).

---

## Roadmap (docs sequence — does not replace v3 autofill)

Product **NOW** is still Install → Import → Autofill ([`../product-maturity.md`](../product-maturity.md)). The list below is the *architecture* order so hosting and agents do not fork the vault.

### Phase 1 — Stabilize what runs

Security-freeze leftovers, Tauri trust boundary, lock lifecycle, `handoff: "raw_secret"` honesty, quieter UI, installer/CI. Stranger-Mac import. No Connection rebuild.

### Phase 2 — Vault Protocol v1 named

[`../vault-protocol.md`](../vault-protocol.md) + running `/api/v1`. CAS, pin, envelopes. No S3/WebDAV.

### Phase 3 — Self-hosted server as the same binary

Desktop ↔ one 4AllPass server. HTTPS off-loopback. No provider directory.

### Phase 4 — Multi-device against that server

Enrol, revoke, CAS 409 reload, rollback pin, offline cache. Second device is a **device envelope**, not a Cloud Edition.

### Phase 5 — MAIP / agent identity core v0.1

Spec: [`../specs/maip-v0.1.md`](../specs/maip-v0.1.md). First among Gnom-Hub, Tollgate, 4AllPass. Still unknown=DENY. FastAPI still mints no vault unwrap. **Not** a second identity product if W3C VC already fits a *human* wallet; MAIP is the *agent* local profile.

### Phase 6 — Credential proxy / mediated access

[`../secret-access-layer.md`](../secret-access-layer.md). Prefer proxy over raw PAT. Default off.

### Phase 7 — Server migration

Sealed snapshot A → B, same Vault Key. Proves no hosting lock-in.

### Phase 8 — Managed hosting partners

Same protocol. Endpoint URL only. No Cloud Edition.

Phase 4+ identity wallet / PQC / Team Mode stay **research or review-only** as in the table above. DNA is never a wrapping secret.

---

## Technical debt (prioritized)

**P0 — product, not vision**

- Stranger-Mac: cards + Keychain + review without password (human).
- Keep FastAPI token-free. Keep review UI free of secrets.
- Do not start Connection/Capability implementation from this file.

**P1 — before any federation / live share-to-a-device**

- Public-key wrapping design (envelope `type`, `cryptoVersion`, KATs) when a real caller exists.
- `AccessRequest` extensible principal (string stays valid).
- `VaultEntry` optional fields / schema bump **with** autofill tests still green.

**P2**

- Item keys if selective live share is a product.
- Agent signing key.
- iOS/Android clients.

**P3 / research**

- Proof layer, eIDAS, attestation of agent runtime, biological identity verification (not DNA-as-key).

---

## Do not build yet

iOS/Android apps, Connection/Capability UI, VaultConnection table, MCP security, n8n marketplace, Chrome write-back, passkey store, 500 providers, Team Mode code, Shamir, ML-KEM, document signing, robots, DNA, Coinbase, PAM, second Tauri, FastAPI token mint, Tollgate merge, S3, WebDAV, Nextcloud, Kubernetes operator, hosted billing, SPIFFE/OAuth agent adapters, DID, blockchain, trust scores, CRDT sync, auto-merge, `packages/vault-protocol`, MAIP library, provider directory.

---

## Protect this architecture

- `packages/crypto` has no UI, no HTTP, no FastAPI.
- VK is random. Account password does not unwrap it.
- Sealed manifest is the revision. Server integer is not.
- Device revoke: envelope vs VK++ as documented.
- Unknown application = DENY.
- Loopback broker; Origin 403.
- Share = new VK, not “ACL on the same VK”.
- Team, if ever: employee vault stays employee-decrypt-only.
- Crypto versions explicit; no silent default.
- Autofill is the 2026 product; Access is not the first screen.

---

## Code hotspots (later agents: read before “just add a type”)

| Path | Risk if naively extended |
|---|---|
| `frontend/src/lib/entries.ts` | `kind` union + required `password` |
| `packages/core/src/policy/types.ts` | `TRUSTED_APPLICATIONS` string list |
| `packages/core/src/access/types.ts` | `application: string` |
| `packages/crypto` envelopes | only `master \| device \| recovery` |
| Snapshot encode path | one VK for all entries |
| `src-tauri` import | OS files, not Device envelopes |
| `extension/src/match.ts` | URL/host, not principal |

---

## ADRs

See [`adr/`](adr/). `accepted` means the **running** system already decided. `proposed` means later.

Existing specs that already decide parts of this: crypto-protocol, vault-revision, recovery, sharing, team-mode (review), post-quantum-roadmap, local-access-broker, capability-contract-v1 (concept).
