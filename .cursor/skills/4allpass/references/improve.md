# What to improve (priority)

Product north star: devices own the vault **cryptographically**. Features that do not strengthen that are later.

`docs/roadmap.md` phases 2–3 are largely done (backend + PWA exist). Do not restart scaffolding.

## Now (security you already specified)

1. **Hard revoke in the PWA**  
   Rotate VK on “this device may already know the key.” Library support exists. Wire `frontend/src/lib/vault-session.ts`, update `security-boundary.md` §4. Prefer landing #15 + #16 (rebase if needed) over a sixth implementation.

2. **Soft revoke that actually drops the envelope**  
   Metadata `DELETE` then commit snapshot N+1 without that device envelope. UX: say “removed from next sync” not “erased.”

3. **Device-Key Envelope mirror ↔ snapshot CAS**  
   Today GET/PUT of the DK envelope is not tied to `active_revision`. A stale generation can be served until the client refuses. Bind them.

4. **Server WebAuthn challenges**  
   One-time, account-bound `publicKey.challenge`. This is ceremony integrity, not wrapping. #12 conflicts — rebase rather than rewrite.

## Next (product you can feel)

5. Recovery kit UX that matches `docs/recovery.md` (print / download once; no e-mail).
6. Chromium extension (MV3) using `@4allpass/crypto` — no second protocol.
7. Import from Bitwarden / 1Password / KeePass (warn on plaintext import).
8. Offline: last good snapshot stays on the device; pin still applies.

## Later (do not start)

- Organizations / teams
- Social login as a crypto factor
- Native apps
- Passkey store as a separate vault product
- Shamir, TOTP, selective sharing — after hard revoke + recovery UX

## How to pick a task

If the user says “improve 4AllPass” without a target, propose **one** item from “Now”, say why, and implement that. Do not open a new architecture debate. The architecture is frozen enough; the gap is wiring and honesty.
