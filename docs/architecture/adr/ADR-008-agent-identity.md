# ADR-008 — Agent identity

**Status:** proposed beyond v1 string + pairing token  
**Date:** 2026-08-24

## Context

Microsoft Entra Agent ID and 1Password Unified Access exist as **enterprise/cloud** products. 4AllPass’s wedge is local-first: person → devices → agent → credential, server still blind.

## Decision

v1 agent = application string + pairing token + human Allow. Documented as spoofable.

Later: agent has a key bound to a **host device**, owner, TTL, scopes. Broker verifies the signature **on the unlocked client**, not as FastAPI minting a GitHub PAT.

Do not implement Connection/Capability UI now.

## Why

Pairing tokens are enough for a desktop demo. They are not attribution for insurance.

## Alternatives

- FastAPI issues agent JWTs with vault material — BLOCK.
- MCP identity — MCP is tools, not the boundary.

## Consequences

n8n HTTP recipe stays Origin-less, loopback, redacted curl.

## Future impact

Same `evaluatePolicy`. New principal fields. No second policy engine.
