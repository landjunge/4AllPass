# ADR-007 — Vault connections

**Status:** proposed — **do not implement now**  
**Date:** 2026-08-24

## Context

Vision: Personal → Work → Agent with scoped capabilities. Independent companies with directional trust.

## Decision

A connection is a **relationship object**, not unwrap of the peer VK.

v1 substitute: share file (new VK, chosen entries). Not live, not revocable after copy.

Live connections **require public-key wrapping** of an item key or a capability key — not of the whole peer VK. Until that envelope `type` exists, do not add a `VaultConnection` table.

FastAPI must never store connection secrets.

## Why

“A knows B” ≠ “A can decrypt B”. Collapsing those is how you get PAM by accident.

## Alternatives

- Put both vaults under one VK — destroys isolation.
- Server ACL on ciphertext — server cannot see items; ACL would be a lie or a backdoor.

## Consequences

Team Mode, if accepted, still does **not** use live vault federation; it XOR-splits the Recovery Key ([`../../team-mode.md`](../../team-mode.md)).

## Future impact

This is the RED item. Design when Phase 1 is actually done (stranger import, reliable autofill), not before.
