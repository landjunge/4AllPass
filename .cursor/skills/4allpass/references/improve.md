# What to improve (priority)

Product north star: devices own the vault **cryptographically**. Features that do not strengthen that are later.

`docs/roadmap.md` phases 2–3 are largely done (backend + PWA exist). Do not restart scaffolding.

## Done on main (do not reimplement)

Hard revoke in the PWA (`hardRevokeDevice`), soft revoke that drops the envelope, DK-mirror CAS, server-issued WebAuthn challenges, COSE registration/assertion verification (ceremony integrity, not PRF), envelope property tests (`fast-check`), reproducible PWA/extension tree hashes, offline wire-snapshot cache (pin still applies), recovery-kit copy, Chromium MV3 autofill, Bitwarden/1Password/KeePass/CSV plaintext import.

## Now (prove, do not build features)

Security freeze. Next work is proof, not product:

- Hard-revoke **across two browsers** (VK₂; victim device-unlock fails; master still works)
- Do not start TOTP, iOS Autofill, Plus, or public-key wrapping

Item-share files are on main (`docs/sharing.md`).

## Later (do not start)

- Organizations / teams
- Social login as a crypto factor
- Native apps
- Passkey store as a separate vault product
- Shamir, TOTP
- Wrapping a Vault Key or item key to a **foreign** Device Key (needs public-key wrapping)
- Post-quantum hybrid-KEM: concept is `docs/post-quantum-roadmap.md`. Do not implement ML-KEM until public-key wrapping exists.

## Far later (community or Plus — not core)

Parked on purpose (2026-08-20). Do not build on “weiter” / “improve”. Revisit only if a community vote asks or the maintainer defines a **Plus shell** (same envelopes, same server never sees plaintext, default **off**).

- Clipboard capture / watcher (never in the PWA as a fake background watch; never default on)
- IDE / MCP / n8n credential provider agent
- Auto-categorize hosting / Plesk / mail / IP from clipboard
- A paid or “Plus” edition that is extra modules, not a second protocol

If Plus ever exists: `packages/crypto` stays unchanged; agent and capture are optional processes. Who does not install them has today’s ZK.

## How to pick a task

If the user says “improve 4AllPass” without a target, propose **one** item from “Now”, say why, and implement that. Do not open a new architecture debate. The architecture is frozen enough; the gap is product you can feel, not more scaffolding.
