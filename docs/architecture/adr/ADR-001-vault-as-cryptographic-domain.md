# ADR-001 — Vault as cryptographic domain

**Status:** accepted (running protocol v1)  
**Date:** 2026-08-24

## Context

The future vision wants many vaults (Personal / Work / Finance) that do not share one key.

## Decision

A vault is a **random Vault Key** plus envelopes plus a sealed snapshot. The server stores an opaque blob and a CAS pointer. It is not a folder and not a SQL table of passwords.

Multiple vault rows already exist in FastAPI (`vaults.owner_user_id`). Local desktop uses one vault. Share files mint a **new** vault id and **new** VK ([`../../sharing.md`](../../sharing.md)).

## Why

Zero-Knowledge and hard-revoke (VK++) only make sense if the vault *is* the key domain.

## Alternatives

- One global key for the user — rejected (hard-revoke and share become lies).
- Folders inside one VK — UX only; not isolation.

## Consequences

Live “Finance may read cards only” is **not** a folder. It is another vault, or item keys (RED in [`../future-architecture.md`](../future-architecture.md)).

## Future impact

Vault federation adds **connections between domains**, not a second meaning of “vault”.
