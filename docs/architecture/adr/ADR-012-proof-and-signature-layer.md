# ADR-012 — Proof and signature layer

**Status:** proposed / research — **do not implement now**  
**Date:** 2026-08-24

## Context

Vision: signed actions, document hash, timestamps, insurance-grade attribution. eIDAS advanced/qualified signatures already exist as **law + trust services**.

## Decision

v1 `AuditEvent` is **not** a proof. Do not rename logs to proofs.

A future proof is a client-side signed statement: who delegated, which capability, which digest, which time. Hardware-backed keys (WebAuthn / enclave) sign. The server stores an opaque blob if needed.

Qualified signatures and DNA-as-secret are out of this repo. Biometrics may gate a device key.

## Why

Calling a JSON log a “proof” would be the same class of over-claim as “server verified PRF”.

## Alternatives

- Server signs everything — the server is not the identity.
- DNA → SHA-256 → private key — BLOCK (non-rotatable secret).

## Consequences

No eIDAS product claim. No robot SKU.

## Future impact

If proofs ship, they are a new item kind + verify UI, after federation keys exist. Use established signature formats; do not invent a 4AllPass-only CMS.
