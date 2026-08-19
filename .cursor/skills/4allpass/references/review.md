# Review playbook

Method: attacker with a **malicious server** and a **hostile local store**, then pin the fix with a test that fails if reverted. See `docs/adversarial-review.md`.

## When this is a review

User says review, PR, adversarial, “is this safe”, compare two branches, or pastes a crypto/backend/frontend diff for 4AllPass.

## Pass order

1. **Claims** — README, PR body, comments, API field names. Flag anything a reader would take as a stronger guarantee than the code.
2. **Invariants** — [invariants.md](invariants.md) + `docs/security-boundary.md`.
3. **Attack classes** (pick those that apply):

| Class | Look for | Tests live in |
|---|---|---|
| AEAD | nonce reuse, AAD from the object itself, truncation, leaked test APIs | `adversarial-aead` |
| Identity | cross-vault / cross-device / entry substitution / wrong envelope kind | `adversarial-identity` |
| Freshness | rollback, mix-and-match, revoked-device replay, version downgrade | `adversarial-freshness` |
| KDF / PRF | raw PRF as key, weak Argon2id accepted, HKDF info unbound | `adversarial-kdf-prf` |
| TOCTOU | parse then mutate, pin desync, hostile JSON shapes | `adversarial-toctou` |
| Boundary | server decrypts, cookie CSRF later, 403 instead of 404, over-claimed revoke | `backend/tests/test_security_*.py` |

4. **Honest revoke / WebAuthn** — `revocation: "metadata_only"`; `serverVerified` stays false unless a ceremony verifier actually landed.
5. **Tests** — every finding needs a named test. “Looks fine” without a failing-if-reverted test is not a crypto sign-off.

## Severity

About what the attacker **gains**, not how hard the patch is.

- **high** — vault plaintext, silent rollback, cross-identity unwrap, KDF downgrade
- **medium** — availability / integrity the client should have detected, over-claim that would mislead an audit
- **low** — docs drift, missing 404 hygiene, test-only leakage

## Do not

- Rubber-stamp a Cursor/Copilot PR because the description is long.
- Propose orgs, social-login wrapping VK, or “server holds a backup key.”
- Merge conflicting PRs (#8, #12) without rebase.
- Open another `cursor/backend-security-boundary-*` branch. Reuse or close.

## After the review

If the change is good enough to ship, say **ship** and list nits separately.
If an invariant moved, the same PR must update `docs/security-boundary.md` (implementation) and the protocol doc (if the protocol moved).
