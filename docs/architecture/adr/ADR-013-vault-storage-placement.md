# ADR-013 — Vault storage is a placement, not a product

**Status:** accepted as the model; Hosted / URL picker / extra backends not built  
**Date:** 2026-08-26

## Context

“Self-hosted” and “Desktop app” are different layers. Mixing them makes 4AllPass look like “only for people who run Docker” or like a cloud password manager.

## Decision

Three layers: **Client** (decrypts) · **Vault Server** (opaque snapshot CAS) · **Hosting** (where that process runs).

Three placements, one protocol: this device only · own server · later 4AllPass Hosted Vault.

The server is never a password manager. Offline local copy is required when a remote placement is on.

Authoritative write-up: [`docs/vault-storage.md`](../../vault-storage.md). Sync bytes: [ADR-006](ADR-006-sync-protocol.md). Mobile still 0 %: [ADR-009](ADR-009-mobile-client.md).

## Why

The running FastAPI already refuses VK / master password / plaintext. Local SQLite and Postgres already speak `/api/v1`. Hosted must not grow a second API. S3/WebDAV would be extra backends, not a new crypto.

## Alternatives

- Desktop-only forever, call that “no cloud sync” — too small; multi-device is the same protocol.
- Hosted as a decrypting cloud PM — BLOCK.
- Per-backend client forks — BLOCK.

## Consequences

Public copy: **Local-first. Sync optional. Server of your choice.** Not “no cloud sync” as a forever claim.

Do not ship a storage-mode UI, a Hosted SKU, or S3/WebDAV until this spec’s “later” is an explicit implement decision. Do not put the vault on the marketing site.
