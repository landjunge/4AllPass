## What

<!-- One theme only. Prefer rebasing an existing branch over a fifth parallel attempt. -->
<!-- Branch prefix: feat/ fix/ docs/ harden/ ci/ chore/ test/ refactor/ -->

## Type

- [ ] feat
- [ ] fix
- [ ] docs
- [ ] harden
- [ ] ci
- [ ] chore
- [ ] test
- [ ] refactor

## Proofs

- [ ] Does not mix account-auth, ownership, and crypto proofs
- [ ] Server still never sees master password, VK, DK, DWK, PRF output, or plaintext entries
- [ ] Foreign vault/device ids stay **404**, not 403
- [ ] FastAPI still mints **no** provider tokens
- [ ] Agent access remains Allow/Deny + TTL (never first screen, never permanent raw secret)

## Claims vs code

- [ ] `docs/` updated in this PR if the claim surface changed
- [ ] No over-claim (e.g. `DELETE /devices` “erases” a key; server “verified” PRF)

## Tests

- [ ] `npm test` / `npm run test:webauthn` / `npm run typecheck` / backend `pytest` as applicable
- [ ] New crypto behaviour has an adversarial or KAT test (`adversarial-aead|identity|freshness|kdf-prf|toctou` or a vector)

## Docs / Workflow

- [ ] If this is docs-only: checklist above still applies where relevant; Self-merge after green CI is fine
- [ ] Follows `docs/git-workflow.md` (Conventional Commits, one theme)

## Review stance

Default: malicious server + hostile store. A review is not a style pass.
