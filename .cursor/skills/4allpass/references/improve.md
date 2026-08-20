# What to improve (priority)

Product north star: devices own the vault **cryptographically**. Features that do not strengthen that are later.

`docs/roadmap.md` phases 2–3 are largely done (backend + PWA exist). Do not restart scaffolding.

## Done on main (do not reimplement)

Hard revoke in the PWA (`hardRevokeDevice`), soft revoke that drops the envelope, DK-mirror CAS, server-issued WebAuthn challenges, recovery-kit copy, Chromium MV3 autofill, Bitwarden JSON/CSV import with a plaintext warning.

## Now (security you already specified)

1. **Server WebAuthn COSE assertion**  
   Verify `authenticatorData` + `clientDataJSON` + signature against the stored COSE public key and the issued challenge. Ceremony integrity, not wrapping, not PRF. `fmt=none` attestation only proves we extracted a key bound to the challenge.

## Next (product / audit you can feel)

2. Envelope property tests (`fast-check`) in CI, on top of KATs.
3. Reproducible frontend/extension builds (`docs/reproducible-builds.md`).
4. Offline: last good snapshot stays on the device; pin still applies.
5. 1Password / KeePass import parsers (Bitwarden/CSV already exist).

## Later (do not start)

- Organizations / teams
- Social login as a crypto factor
- Native apps
- Passkey store as a separate vault product
- Shamir, TOTP, selective sharing — after COSE + the audit-facing items above
- Post-quantum hybrid-KEM: a concept doc only (`docs/post-quantum-roadmap.md`), no implementation

## How to pick a task

If the user says “improve 4AllPass” without a target, propose **one** item from “Now”, say why, and implement that. Do not open a new architecture debate. The architecture is frozen enough; the gap is ceremony verification, audit artifacts, and honesty.
