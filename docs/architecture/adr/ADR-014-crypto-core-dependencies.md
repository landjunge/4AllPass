# ADR-014 — Crypto-core dependencies

**Status:** accepted  
**Date:** 2026-08-28

## Context

`packages/crypto` is the only code that sees Vault Keys. A network or UI
dependency there is a supply-chain path into the vault. v1 already uses
`@noble/ciphers` (AES-GCM) and `@noble/hashes` (Argon2id, SHA-256, HKDF).
`docs/supply-chain-security.md` §2 asks whether to vendor Argon2.

## Decision

Allowlist **only**:

| Crate | Why not the platform |
|---|---|
| `@noble/ciphers` 1.3.0 | Web Crypto AES-GCM is available, but noble gives the same bytes on Node, extension, and PWA without SubtleCrypto wrapping differences. Zero runtime transitives. |
| `@noble/hashes` 2.3.0 | Argon2id and HKDF-SHA-256 are not in Web Crypto as specified. Same author, zero runtime transitives. |

No fetch, no React, no DOM, no second KDF wrapper (`bcrypt` around Argon2, etc.).
A new runtime dep needs a new ADR and a failing `test/supply-chain.test.ts` until
the allowlist is updated.

**Do not vendor Argon2 now.** Noble crates are leaf packages with npm integrity
hashes. Copying their tree into `vendor/` loses that and creates a second
implementation to patch. Revisit if noble is compromised (then pin last-good +
hard-revoke if VK material could have leaked — it should not from a hash crate
alone, but treat crypto-path compromise as rotate).

## Why

Two named crates beat a vendored fork we will not re-audit. The test is the
gate, not a comment.

## Alternatives

- SubtleCrypto-only — BLOCK for Argon2id profiles in `crypto-protocol.md`.
- Vendor argon2 now — deferred; extra tree, same bytes as noble today.
- `libsodium` / `node:crypto` — Node-only; the PWA and extension must share the library.

## Consequences

`packages/crypto/package.json` `dependencies` stays those two keys.
CI `npm test` includes `test/supply-chain.test.ts`.
