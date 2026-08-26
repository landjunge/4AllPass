# ADR-008 — Agent identity

**Status:** proposed beyond v1 string + pairing token  
**Date:** 2026-08-24

## Context

Microsoft Entra Agent ID and 1Password Unified Access exist as **enterprise/cloud** products. 4AllPass’s wedge is local-first: person → devices → agent → credential, server still blind.

## Decision

v1 agent = application string + pairing token + human Allow. Documented as spoofable.

Later: MAIP v0.1 ([`../../specs/maip-v0.1.md`](../../specs/maip-v0.1.md)) — Ed25519 identity document + signed request. Broker verifies on the **unlocked client**, not as FastAPI minting a GitHub PAT. Identity ≠ authorization ([`../agent-identity.md`](../agent-identity.md)).

Do not implement MAIP, Connection, or Capability UI now.

## Why

Pairing tokens are enough for a desktop demo. They are not attribution for insurance.

## Alternatives

- FastAPI issues agent JWTs with vault material — BLOCK.
- MCP identity — MCP is tools, not the boundary.

## Consequences

n8n HTTP recipe stays Origin-less, loopback, redacted curl.

## Future impact

Same `evaluatePolicy`. New principal fields. No second policy engine.
