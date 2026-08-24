# ADR-005 — Crypto agility

**Status:** accepted  
**Date:** 2026-08-24

## Context

Vision wants a CryptoSuite that can migrate. Blind ML-KEM now would be a second protocol with no caller.

## Decision

Every envelope and entry carries explicit `cryptoVersion` (and related versions). Writers state them; readers never default ([`../../crypto-protocol.md`](../../crypto-protocol.md) §1). v1 = Argon2id + AES-256-GCM + HKDF-SHA-256 as specified.

A new algorithm is a **new `cryptoVersion`**. Old clients refuse unknown versions.

## Why

Silent “upgrade” of ciphertext on a malicious server is an attack.

## Alternatives

- Always the latest algorithm, ignore version — BLOCK.
- PQ stickers on AES-only wrapping — dishonest ([`../../post-quantum-roadmap.md`](../../post-quantum-roadmap.md)).

## Consequences

Library owns nonces. Callers do not pass them in.

## Future impact

Hybrid KEM only when public-key wrapping has a real caller (ADR-007 / ADR-010).
