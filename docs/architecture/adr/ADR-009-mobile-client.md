# ADR-009 — Mobile client

**Status:** proposed — 0 % app code now  
**Date:** 2026-08-24

## Context

Password managers live on phones. Passkeys and TOTP prefer mobile. Building iOS+Android now would dwarf the desktop product.

## Decision

Mobile is a **future first-class device** of the same vault. Crypto and snapshots stay platform-neutral. Do not start Electron / iOS / Android in the v3 sequence.

Do not assume Desktop = the vault.

## Why

`packages/crypto` is already usable from JS. The gap is OS Autofill / passkey provider APIs, not a new envelope.

## Alternatives

- PWA on mobile as the only phone client — acceptable until native Autofill is worth it. Not a second protocol.
- “Mobile fork” of crypto — BLOCK.

## Consequences

Phone-as-recovery-device and phone-approve-agent are LATER and need wrapping/attestation (ADR-003, ADR-007).

## Future impact

When (if) apps exist: same VK, same recovery kit, same unknown=DENY.
