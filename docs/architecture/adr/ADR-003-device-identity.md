# ADR-003 — Device identity

**Status:** accepted for envelopes; proposed for Mobile/browser-as-device  
**Date:** 2026-08-24

## Context

Vision: Desktop, Mobile, Browser, Agent host as devices.

## Decision

A **device** is whatever can hold Device Key material and an envelope. Today: PWA / desktop webview with WebAuthn PRF or master unwrap.

Mobile is a **future client of the same envelopes**, not a second protocol. 0 % iOS/Android code in the v3 sequence.

Browser **profiles** (Chrome Default / Arbeit) are import sources, not devices, until someone explicitly enrols them with an envelope.

## Why

Device revoke is already cryptographic. Treating “Chrome is installed” as trust would be a lie.

## Alternatives

- Device = desktop only — would block Mobile.
- Device = OS login session — not ZK.

## Consequences

Tauri import (`src-tauri`) copies Login Data. That is **ingest**, not enrol.

## Future impact

Phone approval / “unlock Mac from iPhone” needs hardware-backed keys and a wrapping path that v1 does not have (see ADR-007). Do not fake it with “phone stores the master password”.
