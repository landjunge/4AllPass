# ADR-002 — Principal identity

**Status:** proposed (do not implement now)  
**Date:** 2026-08-24

## Context

Vision: Human, Device, Browser, Agent, Organization, Machine. Today: account e-mail (storage) + vault master password (crypto) + `application: "n8n"` (policy string).

## Decision

**Do not** treat account e-mail as a principal type. Storage auth ≠ vault unwrap ([`../../security-boundary.md`](../../security-boundary.md)).

Later, principals are client-side objects. Policy may grow `principalType` **beside** the existing application string so n8n recipes do not break.

Robots and organizations are LATER types, not a 2026 table.

## Why

Overloading User=Human as crypto would block agents. Overloading e-mail as identity would block ZK.

## Alternatives

- FastAPI User table as the only principal — rejected.
- One IAM cloud — out of scope; 4AllPass is local-first.

## Consequences

`TRUSTED_APPLICATIONS = ["n8n"]` stays the v1 allow-list. Unknown = DENY.

## Future impact

Team Mode ([`../../team-mode.md`](../../team-mode.md)) adds organization **participation**, not admin-held VK.
