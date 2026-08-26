# ADR-006 — Sync protocol

**Status:** accepted for snapshot CAS; proposed for partial sync  
**Date:** 2026-08-24

## Context

Vision: Encrypted object → sync protocol → device. Not “copy the SQLite file to the phone”.

## Decision

v1 sync is **sealed snapshot CAS**: whole ciphertext, `expectedRevision`, sealed manifest. Clients pull the snapshot the server points at. Extension, while unlocked, pulls a newer revision with the cached VK.

Plaintext browser DBs are never the sync medium. No write-back into Chrome `Login Data`.

## Why

File copy of `vault.db` would mix server blobs with client keys. Live Chrome DB is locked and not ours.

## Alternatives

- Sync = copy Login Data — rejected.
- Per-field CRDT of plaintext — BLOCK.

## Consequences

Selective “phone gets TOTP only” is **not** implemented. It needs item keys or a second vault (YELLOW/RED).

Two writers at revision N both committing N+1: exactly one 200, one 409. **Not** last-write-wins. v1 client loads the winner; it does not auto-merge entries. Placement / 409 UX: [`docs/vault-storage.md`](../../vault-storage.md).

## Future impact

Do not couple this protocol to Tauri. PWA, extension, and a later mobile client consume the same snapshot.
