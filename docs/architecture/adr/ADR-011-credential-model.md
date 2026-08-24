# ADR-011 — Credential model

**Status:** accepted as wide `VaultEntry` JSON; proposed kinds later  
**Date:** 2026-08-24

## Context

Vision: secrets / identity / assets / documents / proofs. Today: `VaultEntry` with `kind: web | api | sftp`, required `password`, optional `totpSecret`, `credentialType` string.

## Decision

Keep v1 entries boring for autofill. `ENTRY_SCHEMA_VERSION` is the extension point.

Do **not** ship a 12-member union in the same slice as GitHub fill.

Policy continues to use `@4allpass/core` `Credential` **without** a password field.

4AllPass is not a bank, not an IdP, not a chain. Cards/coins/IDs are **item kinds** later, plus “store less, prove more” via **standards** (VC / OpenID4VP), not a homemade passport.

## Why

Autofill reliability is the 2026 product. Schema archaeology in `fill.ts` would stall P0.

## Alternatives

- Separate tables per kind on the server — BLOCK (plaintext / server-aware).
- Password-only struct forever — would block TOTP (already added as a field) and passkeys.

## Consequences

Adding `kind: "note"` is a schema bump + UI. Adding passkey **store** is platform APIs (P3 in product-maturity).

## Future impact

Proofs are not credentials. Do not stuff signatures into `password`.
