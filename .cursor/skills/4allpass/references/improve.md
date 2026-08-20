# What to improve (priority)

Product north star: devices own the vault **cryptographically**. Features that do not strengthen that are later.

`docs/roadmap.md` phases 2–3 are largely done (backend + PWA exist). Do not restart scaffolding.

## Done on main (do not reimplement)

Hard revoke in the PWA (`hardRevokeDevice`), soft revoke that drops the envelope, DK-mirror CAS, server-issued WebAuthn challenges, COSE registration/assertion verification (ceremony integrity, not PRF), envelope property tests (`fast-check`), reproducible PWA/extension tree hashes, recovery-kit copy, Chromium MV3 autofill, Bitwarden JSON/CSV import with a plaintext warning.

## Now (product you can feel)

1. Offline: last good snapshot stays on the device; pin still applies.
2. 1Password / KeePass import parsers (Bitwarden/CSV already exist).

## Later (do not start)

- Organizations / teams
- Social login as a crypto factor
- Native apps
- Passkey store as a separate vault product
- Shamir, TOTP, selective sharing — after offline snapshot cache
- Post-quantum hybrid-KEM: a concept doc only (`docs/post-quantum-roadmap.md`), no implementation

## How to pick a task

If the user says “improve 4AllPass” without a target, propose **one** item from “Now”, say why, and implement that. Do not open a new architecture debate. The architecture is frozen enough; the gap is product you can feel, not more scaffolding.
