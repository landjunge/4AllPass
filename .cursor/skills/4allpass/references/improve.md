# What to improve (priority)

Product north star: devices own the vault **cryptographically**. Features that do not strengthen that are later.

`docs/roadmap.md` phases 2–3 are largely done (backend + PWA exist). Do not restart scaffolding.

## Done on main (do not reimplement)

Hard revoke in the PWA (`hardRevokeDevice`), soft revoke that drops the envelope, DK-mirror CAS, server-issued WebAuthn challenges, COSE registration/assertion verification (ceremony integrity, not PRF), envelope property tests (`fast-check`), reproducible PWA/extension tree hashes, offline wire-snapshot cache (pin still applies), recovery-kit copy, Chromium MV3 autofill, Bitwarden/1Password/KeePass/CSV plaintext import.

## Now (product you can feel)

No queued item. Item-share files are on main (`docs/sharing.md`). Do not add public-key wrapping unless asked.

## Later (do not start)

- Organizations / teams
- Social login as a crypto factor
- Native apps
- Passkey store as a separate vault product
- Shamir, TOTP
- Wrapping a Vault Key or item key to a **foreign** Device Key (needs public-key wrapping)
- Post-quantum hybrid-KEM: concept is `docs/post-quantum-roadmap.md`. Do not implement ML-KEM until public-key wrapping exists.

## How to pick a task

If the user says “improve 4AllPass” without a target, propose **one** item from “Now”, say why, and implement that. Do not open a new architecture debate. The architecture is frozen enough; the gap is product you can feel, not more scaffolding.
