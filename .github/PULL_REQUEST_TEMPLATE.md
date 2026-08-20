## What

<!-- One theme. Prefer rebasing an existing branch over a fifth parallel attempt. -->

## Proofs

- [ ] Does not mix account-auth, ownership, and crypto proofs
- [ ] Server still never sees master password, VK, DK, DWK, PRF output, or plaintext entries
- [ ] Foreign vault/device ids stay **404**, not 403

## Claims vs code

- [ ] `docs/` updated in this PR if the claim surface changed
- [ ] No over-claim (e.g. `DELETE /devices` “erases” a key; server “verified” PRF)

## Tests

- [ ] `npm test` / `npm run test:webauthn` / `npm run typecheck` / backend `pytest` as applicable
- [ ] New crypto behaviour has an adversarial or KAT test (`adversarial-aead|identity|freshness|kdf-prf|toctou` or a vector)

## Review stance

Default: malicious server + hostile store. A review is not a style pass.
