# Vault storage — Client, Vault Server, Hosting

**Status:** Standing model. Protocol v1 unchanged.  
**Date:** 2026-08-26  
**Not this document:** a second product, a cloud password manager, S3/WebDAV/Nextcloud, a mobile app, or a live 4AllPass Hosted SKU.

Companion: [`security-boundary.md`](security-boundary.md), [`architecture/adr/ADR-006-sync-protocol.md`](architecture/adr/ADR-006-sync-protocol.md), [`architecture/adr/ADR-009-mobile-client.md`](architecture/adr/ADR-009-mobile-client.md), [`product-philosophy.md`](product-philosophy.md).

---

## Claim (public)

DE: **Dein Tresor gehört dir. Wo der verschlüsselte Tresor liegt, entscheidest du.**

EN: **The vault is yours. Where the encrypted vault lives is your choice.**

Positioning, not “self-hosted only”:

> **Local-first. Sync optional. Server deiner Wahl.**  
> **Kein verpflichtender Cloud-Dienst.**

Bitwarden: the server is part of the concept.  
1Password: their infrastructure.  
4AllPass: **no server required. Your server possible. Hosted optional.**

Do **not** call a future offering “Cloud Password Manager”. Name: **4AllPass Hosted Vault** (encrypted availability, not a place that decrypts).

---

## Three layers (never mix)

| Layer | What it is | What it is not |
|---|---|---|
| **1. 4AllPass Client** | Desktop now. Browser extension now. Mobile later. Decrypts. Holds Master Key / Vault Key after unlock. Shows passwords. | A website that is the vault. |
| **2. 4AllPass Vault Server** | Snapshot CAS. Ciphertext, revisions, device envelopes, metadata. Same API whether the process is local SQLite or Postgres. | A password manager. It has no Vault Key, no master password, no plaintext. |
| **3. Hosting** | Where that server process runs: this Mac, the user’s VPS/NAS, or later a 4AllPass-operated instance. | A second protocol. |

```text
                  ┌──────────────┐
                  │ Client       │
                  │ decrypts     │
                  └──────┬───────┘
                         │
                encrypted snapshot
                         │
        ┌────────────────▼───────────────┐
        │ 4AllPass Vault Endpoint        │
        │ ciphertext · revisions         │
        │ device envelopes · metadata    │
        │ NO vault key · NO master PW    │
        │ NO plaintext                   │
        └────────────────┬───────────────┘
                         │
                encrypted snapshot
                         │
                  ┌──────▼───────┐
                  │ Other device │
                  │ decrypts     │
                  └──────────────┘
```

Not: `Desktop → Server → passwords`.  
The server is a **sealed vault relay / storage service**.

`packages/crypto` does not change for placement. FastAPI still never mints vault secrets.

**The server is never the trust anchor for secrets.** Placement (this device, own server, later Hosted) does not move that line.

---

## Non-negotiables

These hold for every placement. A Hosted SKU that breaks one of them is a defect, not a product.

| Rule | Today | Later |
|---|---|---|
| **Client-side encryption only.** Master password, Vault Key, plaintext stay on the device. Server gets sealed snapshots, envelopes, technical metadata. | Held (`security-boundary.md`) | Must stay held |
| **Own server and Hosted speak the same API.** No Hosted special path. Same client, other URL. | Local SQLite and Postgres already share `/api/v1` | URL field; Hosted is that URL |
| **Offline-first.** Server down ≠ locked out. Last valid sealed local copy stays usable. | Wire-snapshot cache + pin (`vault-revision.md` §3.2) | Clearer sync status |
| **Conflicts are CAS, not last-write-wins.** Two devices at 27 both writing 28: one 200, one 409. No silent overwrite. | Server CAS + unique `(vault_id, revision)` | Same |
| **No automatic entry merge in v1.** 409 → tell the user, load the winning snapshot. | `CommitConflict`; no merge code | Entry-level merge only if specified later |
| **Rollback protection.** “I pinned 52, why is this 47?” | `assertFreshSnapshot` / `RollbackError` | Same on Hosted restores |
| **Devices have cryptographic identity.** Display name is not trust. Enrol = Device Envelope; revoke = omit envelope / `vaultKeyVersion++`. | Envelopes + `hardRevokeDevice`. `X-Device-Id` is still client-asserted | Do not fake OS-binding |
| **Recovery does not depend on the server.** No reset link. Hosted gone tomorrow still works if the user has kit + sealed copy. | Recovery Key / Emergency Kit; no e-mail reset | Same |
| **Server move is a placement change.** New endpoint, copy sealed snapshot, same Vault Key. Not a new vault and not a password export. | Not a UI. Share-v1 is a *new* VK — that is not a move | Endpoint switch + sealed copy |
| **Metadata: only what CAS, ownership, and revoke need.** Ciphertext still leaks count, size, timing. Do not add more. | Account email, device label, `last_seen`, blob size | Do not log IPs into the vault row |
| **TLS is required off-loopback.** ZK does not replace HTTPS. HTTP only `127.0.0.1` / `localhost` / `::1`. | Local profile is loopback HTTP | Own-server URL field: HTTPS only |
| **Auth ≠ encryption.** Session may read snapshot X. It cannot unwrap VK. | Three proofs | Same |
| **Hosted isolation.** Vault A never mixed with vault B. Rate limits, backups, abuse, updates are *ops*, not crypto. | `get_owned_vault` → 404 | Hosted runbook when (if) we operate |
| **Backups are ciphertext.** Restoring an old snapshot is a rollback; the client pin still refuses. | Snapshots are immutable | Hosted backups must not skip the pin |
| **Exit Hosted without permission.** Export/move without a support ticket and without a proprietary format. | Wire snapshot + recovery kit *are* the format | A user-visible “take this snapshot elsewhere” action |

---

## Sync is the hard part

Not the bytes on the wire. The states:

```text
Laptop: 27
Phone:  27
Server: 27

Laptop writes 28
Phone  writes 28
```

4AllPass must not pick a winner by clock. Protocol (already running):

```text
GET  /api/v1/vaults/{id}/snapshots/current
  → revision, ciphertext, sealed manifest, envelopes

POST /api/v1/vaults/{id}/snapshots
  expectedRevision: 27
  revision: 28
  ciphertext + manifest + envelopes

if active == 27 → 200, now 28
else            → 409 Conflict (currentRevision)
```

Authoritative: [`vault-revision.md`](vault-revision.md) §4, [`security-boundary.md`](security-boundary.md) §5.

v1 client after 409:

> Änderungen auf einem anderen Gerät erkannt. Aktuelle Version laden.  
> Changes on another device. Load the current version.

Do **not** auto-replay the loser’s in-memory entries on top of 28 (that would drop the winner’s edits). Do **not** start a CRDT or per-field merge ([ADR-006](architecture/adr/ADR-006-sync-protocol.md) already BLOCKs plaintext CRDT). Entry-level merge is later, explicit, and tested.

**Today:** the PWA throws `CommitConflict` and does not update the pin. Save-again still sends `expectedRevision` of the stale vault until the user reloads. There is no dedicated “load current version” copy yet. That is a UX gap, not a CAS gap.

---

## Three operating modes (same client, same protocol)

### 1. Nur dieses Gerät / This device only

No remote server. No sync. Maximal local.

**Today:** Desktop + `python -m app.local` / `npm run app`. SQLite in the app data dir. Loopback only. This is the product default.

### 2. Eigener Server / Own server

The user points the client at their Vault Endpoint:

```text
https://vault.example.com
```

Only encrypted snapshots land there. Classic self-hosting.

**Today:** FastAPI + Postgres exists (`docker-compose`, `profile=server`). The Desktop app does **not** yet expose a URL field. The PWA talks to the origin that serves it. Same snapshot API as local.

### 3. 4AllPass Hosted Vault

We run the same Vault Server. The user does not configure Docker, domain, or TLS.

Same protocol:

```text
Client
  → encrypted snapshot
4AllPass Hosted Vault
  → encrypted blob
```

Full server access still cannot read passwords.

**Today:** not offered. Do not invent a live host name. Marketing site `4allpass.netzwerkpunkt.de` is **not** a vault endpoint and must never receive the vault.

---

## One API

Do not grow a second storage protocol for Hosted. Do not special-case the client.

v1 sync is already sealed snapshot CAS ([ADR-006](architecture/adr/ADR-006-sync-protocol.md)): whole ciphertext, `expectedRevision`, sealed manifest, device envelopes. Local SQLite and Postgres both speak `/api/v1`.

Later, the client should know one configurable endpoint:

```text
Storage Mode

● This device only

○ Own 4AllPass server
  https://vault.example.com

○ 4AllPass Hosted Vault
  (URL we publish later — same protocol)
```

Underneath, always:

> Der Server erhält ausschließlich verschlüsselte Daten. / The server receives encrypted data only.

That picker is **not built**. Do not add it in a drive-by UI PR.

---

## Offline

Desktop must not say “server unreachable → no password.”

```text
Local sealed copy
        +
Remote sealed snapshot (when a remote mode is on)
```

Work locally. When the endpoint is back: sync revisions.

**Today:** offline wire-snapshot cache exists; the revision pin still gates unlock (`frontend/src/lib/snapshot-cache.ts`, `docs/vault-revision.md` §3). That is local-first for the current snapshot, not a full multi-device queue.

Self-host (Raspberry Pi, NAS, VPS) being offline is expected. Local-only mode has no remote to miss.

---

## Mobile (logical, not this sequence)

Laptop commits revision 41 → endpoint stores sealed snapshot + device envelopes.  
Phone fetches 41, decrypts **on the phone**, commits 42.  
Laptop: newer revision present → pull 42.

Same Vault Key, same recovery kit, same unknown=DENY.

**Today:** 0 % iOS/Android app code ([ADR-009](architecture/adr/ADR-009-mobile-client.md)). Do not couple the vault format to Tauri. PWA on a phone is acceptable until native Autofill is worth it — not a second protocol.

---

## Server move and exit (no lock-in)

The sealed snapshot is the portable unit: envelopes + encrypted entries + sealed manifest. Same Vault Key. Same recovery kit.

```text
Endpoint A  --copy sealed snapshot-->  Endpoint B
Client points at B
Pin still applies (a restored older revision is a rollback)
```

That is **not** “export CSV and re-import.” It is **not** `4allpass-share-v1` (that file mints a new Vault Key). It is **not** a support ticket.

> Der Nutzer muss jederzeit aus Hosted herauskommen können — ohne Zustimmung, ohne Ticket, ohne Sonderformat.

**Today:** no “change vault URL” UI. Recovery kit + local cache exist. Do not invent a second archive format.

---

## Hosted is a separate ops product

Crypto stays the same. Operating a multi-tenant endpoint **adds** problems that self-hosting leaves with the operator:

Datenschutz / deletion, availability, backups, incident response, server logs, DPA for firms, data region, abuse, support.

That does not forbid Hosted. It means Hosted is **not** “turn on a flag on the Open-Source server.” Isolation (`get_owned_vault` → 404) is already the storage rule; rate limits, tenancy ops, and legal text are not.

Do not start that SKU in this sequence.

---

## Sequence (storage only — does not replace autofill v3)

```text
Phase 1  Local-only stable          ← product default now
Phase 2  Own 4AllPass server optional  (compose exists; client URL field later)
Phase 3  Two devices vs that self-hosted server (CAS 409 + pin + revoke)
Phase 4  Same binary as Hosted Vault, only after 3 is real
```

Test the software you would later host. Do not skip to Phase 4.

---

## Do not build now

| Idea | Why not now |
|---|---|
| Storage-mode radio in Settings | Spec first. Default remains this-device. |
| 4AllPass Hosted operations | Same API later. No SKU, no extra domain as vault host. |
| S3 / WebDAV / Nextcloud / “NAS as protocol” | Extra backends. One Vault Server API first. |
| Calling Hosted a cloud password manager | Lies about who decrypts. |
| Last-write-wins or silent 409 retry that replays local entries | Drops the other device’s edits. |
| Automatic entry-level merge | Later, explicit. v1 = reload. |
| E-mail / support vault reset | Recovery kit only. |
| Mobile apps | v3 sequence: desktop + autofill. |
| FastAPI minting secrets so Hosted “just works” | Boundary defect. |
| Hosted SKU, DPA, multi-region | Phase 4. Ops product, same API. |

If a second storage backend ever exists, it still stores **opaque snapshots**. It does not become a password manager.

---

## Honest today vs later

| | Today | Later (same protocol) |
|---|---|---|
| Decrypt | Client only | Client only |
| Local-only Desktop | Yes | Yes (default stays valid) |
| Own FastAPI server | Yes (self-host compose) | Yes, plus a URL field in the client |
| Hosted Vault | No | Optional placement |
| Offline unlock of last pinned snapshot | Yes | Yes, plus clearer sync status |
| CAS 409, no last-write-wins | Yes (server + `CommitConflict`) | Dedicated “load current version” copy |
| Recovery without the server | Yes | Same if Hosted vanishes |
| Change vault endpoint / exit Hosted | No UI | Sealed snapshot copy, same VK |
| HTTPS off-loopback | Local is loopback HTTP | Own-server URL: HTTPS only |
| Mobile as first-class device | No | Yes, not a fork |
| S3 / WebDAV | No | Only if the one API stays the client contract |
