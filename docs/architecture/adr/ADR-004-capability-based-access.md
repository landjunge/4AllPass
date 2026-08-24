# ADR-004 — Capability-based access

**Status:** accepted for v1 policy; proposed for cryptographic capabilities  
**Date:** 2026-08-24

## Context

Agents must not receive the whole vault. Connection must not mean access.

## Decision

v1: `evaluatePolicy` + human Allow + TTL + scope strings. Grant metadata has **no** password. FastAPI is not the broker. Unknown app DENY. Concept contract: [`../../capability-contract-v1.md`](../../capability-contract-v1.md) (not implemented).

A **capability is permission to use secret X for Y**, not a copy of X.

Discovery ≠ Trust ≠ Capability.

## Why

Boolean “n8n on/off” is all-or-nothing. Scope + TTL is the smallest honest grant.

## Alternatives

- MCP as security — rejected.
- FastAPI mints API tokens — rejected.
- Auto-handoff on `decision: "allow"` — rejected (`allow` means eligible for a human click).

## Consequences

`application` is still a spoofable string. That is documented, not a proof.

## Future impact

4AP-CAP-1 Issue/Verify/Inspect/Revoke stays the later contract. Do not merge Tollgate.
