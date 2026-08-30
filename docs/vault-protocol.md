# 4AllPass Vault Protocol v1

**Status:** Named contract. Snapshot CAS `/api/v1` is **implemented**. Capabilities endpoint, URL picker, Hosted SKU are **not**.  
**Date:** 2026-08-26  
**Crypto:** [`crypto-protocol.md`](crypto-protocol.md). **Placement:** [`vault-storage.md`](vault-storage.md).  
**Not this document:** a Cloud Edition, `packages/vault-protocol`, S3, or a provider directory.

The running routes are FastAPI `/api/v1`. This file names that contract so hosting cannot become a second protocol.

---

## Invariant

```text
A valid 4AllPass client MUST remain capable of
decrypting and using a vault without access to
the hosting provider that previously stored it.
```

DE: **Ein 4AllPass-Tresor darf niemals technisch von seinem Hosting-Anbieter abhängig sein.**

The hosting operator replaces only the **storage and sync location**. They are never part of the cryptography or the trust model.

---

## Four parts (never mix)

```text
┌──────────────────────────────┐
│ 4AllPass Clients             │
│ Desktop · Extension · Mobile │
│ (decrypt, pin, recovery)     │
└──────────────┬───────────────┘
               │ ciphertext only
┌──────────────▼───────────────┐
│ 4AllPass Vault Protocol v1   │
│ auth · snapshots · revisions │
│ envelopes · CAS · 409        │
└──────────────┬───────────────┘
               │
     ┌─────────┴─────────┐
┌────▼─────┐      ┌──────▼──────────┐
│ Local    │      │ Remote server   │
│ storage  │      │ Self-hosted     │
│ only     │      │ Managed host    │
└──────────┘      │ Partner host    │
                  └─────────────────┘
```

The client talks to a **Vault Endpoint** (`url` + protocol version + auth). It does not know whether that process is SQLite on this Mac, Postgres on a VPS, or a partner.

No `if provider == hetzner` in crypto or the PWA.

---

## What the client owns

Master password, KDF, Vault Key, encrypt/decrypt, recovery, device envelopes, snapshot verification, rollback pin.

The server **must not** `decrypt(vault)`. It may:

```text
store(ciphertext)
retrieve(ciphertext)
compare_revision()
authorize(account → vault)
```

It must not: merge credentials, generate passwords, autofill, run agents, classify secrets, wrap a Vault Key to a **provider** key.

Forbidden:

```text
ProviderEncryptionKey / ProviderMasterKey / ProviderRecoveryKey
Vault Key → Hoster Key
```

Allowed:

```text
Vault Key → client encryption → ciphertext → any host
```

---

## Auth is not crypto

```text
Account session  →  may GET/POST this vault’s blobs
Master password  →  unwraps VK on the device
```

A stolen session yields ciphertext. It does not yield passwords. Three proofs: [`security-boundary.md`](security-boundary.md) §1.

---

## Wire (what runs)

Base: `/api/v1`. Ownership: foreign ids are **404**.

| Method | Path | Role |
|---|---|---|
| `GET` | `/vaults/{vaultId}/snapshot` | Current sealed snapshot |
| `POST` | `/vaults/{vaultId}/snapshots` | CAS commit (`expectedRevision` → `revision`) |
| `GET` | `/vaults` | Vault list (metadata) |
| `POST` | `/vaults` | Create vault row |
| `GET` | `/vaults/{vaultId}/devices` | Device metadata |
| `POST` | `/vaults/{vaultId}/devices` | Register device metadata |
| `DELETE` | `/vaults/{vaultId}/devices/{deviceId}` | Metadata revoke (`metadata_only`) |
| `PUT/GET` | `…/device-key-envelope` | Opaque DK-mirror, same CAS pointer |

Normative CAS, pin, manifest: [`vault-revision.md`](vault-revision.md).  
Blob ceilings: `backend/app/core/limits.py` (body **32 MiB**, aligned with `packages/crypto`). The ASGI middleware counts chunked frames, not only `Content-Length`. Nginx `client_max_body_size` is **32m** on the vault vhost. Account passwords are capped at 256 characters (Argon2id on the server).

HTTP **409** `revision conflict` = another writer won. v1 client reloads the winner. No last-write-wins. No entry merge.

Protocol version is **1** for as long as this snapshot shape holds. App version (`2.8` vs server `1.9`) must not break a v1 client. Alembic may change Postgres; the wire stays v1.

---

## What the server may know vs must not

| May store | Must never see |
|---|---|
| `vault_id`, `account_id` | Entry title, username, password, URL, notes |
| `device_id` (client-asserted), device **label** | TOTP secret |
| `revision`, `vault_key_version` (as client-supplied numbers) | Vault Key, Master Password, Recovery Key |
| Snapshot byte size, timestamps | PRF output, DWK, DK plaintext |
| Sealed blobs (opaque) | Anything that would make `decrypt(vault)` possible |

Ciphertext size and timing still leak. Do not add IP addresses to the vault row.

---

## Device identity (honest)

Today a **device** is: a `device_id`, an optional display name, and a **Device Envelope** wrapping the Vault Key to a Device Key that never leaves the client. Hard-revoke is `vaultKeyVersion++` on the client.

`X-Device-Id` is **not** cryptographic proof ([`security-boundary.md`](security-boundary.md) §2). Display name is not trust.

v1 enrollment on a new machine is **master password or recovery kit**, then a new envelope in the next snapshot. “Laptop approves phone” without sharing the master password needs wrapping VK to a **foreign** Device Key (public-key wrapping). That is later ([`post-quantum-roadmap.md`](post-quantum-roadmap.md), [ADR-007](architecture/adr/ADR-007-vault-connections.md)). Do not fake it.

The server may store `device_id` + opaque envelope. It must not store a provider-held device private key.

---

## Capabilities (not built)

Later, a v1 server may advertise:

```http
GET /api/v1/server/capabilities
```

```json
{
  "protocol": 1,
  "snapshot": true,
  "device_envelopes": true,
  "max_snapshot_bytes": 33554432
}
```

Until that exists, compatibility is: the routes above + HTTPS off-loopback + 409 on CAS miss. Do not add a Hosted-only capability bit.

---

## Internal storage (server, not client)

The FastAPI process may later grow `VaultStorage` (`getSnapshot` / `putSnapshot` / `getRevision`) with Postgres, filesystem, or S3 **behind** the protocol.

The client still sees only Vault Protocol v1. Do not implement S3/WebDAV/Nextcloud now. SQLite (local) and Postgres (server profile) already speak the same `/api/v1`.

---

## Endpoint, not provider

```json
{ "name": "My Vault", "url": "https://vault.example.org" }
```

The client cares about URL, protocol version, account session, TLS, later capabilities. Not who pays the VPS.

A provider directory, one-click deploy, or OAuth-to-Hetzner is **Phase 6**. If deploy tokens ever exist, they are temporary; 4AllPass must not become a hosting-password manager.

---

## Portable snapshot (not share-v1)

Migration and backup of **the same vault** is the sealed snapshot (envelopes + entries + manifest) plus the recovery kit. Same Vault Key.

`4allpass-share-v1` is a **new** Vault Key for selected entries. That is not a move.

A user-facing `.4allpass` archive (same bytes, a filename) is later. Do not invent a second crypto format for it.

---

## “4AllPass Compatible” (later)

A hosted operator that claims compatibility must: Protocol v1, HTTPS (TLS 1.2+), body limits, tenant isolation (`get_owned_vault` → 404), no content inspection, export/migration of the sealed snapshot, backups that the client pin still treats as rollback if stale.

Not a marketing badge in this sequence.

---

## Do not extract yet

Long-term tree (`packages/vault-protocol`, `server/`, `mobile/`) is a map, not a refactor ticket. Today: `packages/crypto`, `backend/`, `frontend/`, `extension/`, `src-tauri/`. Do not start a fifth package for types the FastAPI schemas already are.

OpenAPI may later be generated from the running app. The human spec is this file + [`vault-revision.md`](vault-revision.md).
