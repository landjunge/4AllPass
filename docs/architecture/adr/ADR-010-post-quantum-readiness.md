# ADR-010 — Post-quantum readiness

**Status:** accepted as **documentation + non-implementation**  
**Date:** 2026-08-24  
**Spec:** [`../../post-quantum-roadmap.md`](../../post-quantum-roadmap.md)

## Context

AES-256-GCM wrapping does not need ML-KEM. COSE ES256 on the server is ceremony integrity, not VK wrap.

## Decision

Do not implement ML-KEM, ML-DSA, or SLH-DSA until a feature **wraps keys to a public identity**. Then: new `cryptoVersion`, hybrid KEM, KATs in the same PR.

Do not claim “AES-256 is post-quantum” as marketing. Grover halves bits; NIST still treats AES-256 as the PQ-symmetric default. Say that.

## Why

A KEM with no caller is protocol surface for no user.

## Alternatives

- PQ everywhere now — rejected.
- Ignore versions — BLOCK.

## Consequences

Sharing to a **foreign Device Key** is the trigger, not a README badge.

## Future impact

Crypto agility (ADR-005) is the actual NOW work: keep versions honest.
