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

## Do not build now

| Idea | Why not now |
|---|---|
| Storage-mode radio in Settings | Spec first. Default remains this-device. |
| 4AllPass Hosted operations | Same API later. No SKU, no extra domain as vault host. |
| S3 / WebDAV / Nextcloud / “NAS as protocol” | Extra backends. One Vault Server API first. |
| Calling Hosted a cloud password manager | Lies about who decrypts. |
| Mobile apps | v3 sequence: desktop + autofill. |
| FastAPI minting secrets so Hosted “just works” | Boundary defect. |

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
| Mobile as first-class device | No | Yes, not a fork |
| S3 / WebDAV | No | Only if the one API stays the client contract |
