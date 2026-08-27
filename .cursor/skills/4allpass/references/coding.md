# Coding conventions

## Default change shape

Smallest PR that:

1. Implements one invariant or one product slice.
2. Adds/extends tests in the matching package.
3. Updates the spec if the claim surface changed (`security-boundary.md` for “what runs”, protocol docs for “what must be true”).

Do not stack “also I refactored the PWA” onto a crypto PR.

## Crypto (`packages/crypto`)

- No `fetch`, no DOM, no `@simplewebauthn`, no Node-only APIs in the core path.
- Library generates AES-GCM nonces. Callers do not pass nonces in.
- New unwrap/decrypt functions take an options object of **expectations**.
- Keep `cryptoVersion` / `schemaVersion` on sealed objects, not only in outer JSON.
- Prefer extending an existing adversarial file over a new “test_my_feature.spec.ts” that only happy-paths.

## WebAuthn (`packages/webauthn`)

- Order is PRF → largeBlob → UV-gated local store. Document the weaker fallback; do not hide it.
- Challenges for ceremonies must be **server-issued and one-time**. Client `newChallenge()` is not bindable. Consuming a challenge is not COSE verification.

## Backend

- Opaque bytes in, opaque bytes out. Request schemas reject VK/DK/password-equivalent fields.
- `get_owned_vault` on every vault-scoped route.
- Snapshot writes stay race-safe (`FOR UPDATE` + CAS + unique revision).
- Device DELETE remains honest: `revocation: "metadata_only"`. Cryptographic erase is `hardRevokeDevice` on the client, not DELETE.
- Alembic migration in the same PR as the model change.
- Tests: `backend/tests/security/` (auth, IDOR, devices, snapshot CAS), `test_security_unit.py`, `test_ownership.py`, `test_auth.py`.

## Frontend

- All crypto via `@4allpass/crypto` / `@4allpass/webauthn`. Do not reimplement unwrap in a page.
- `vault-session.ts` is the sensitive module. Hard revoke / rotation belongs here, not in a random component.
- Session token in `sessionStorage` is an accepted XSS trade (account, not vault). Don’t “fix” it by stuffing VK into `localStorage`.
- E2E: `frontend/e2e/` + virtual authenticator. Don’t claim PRF coverage from a mocked `prfSupported: true`.

## Docs

- Implementation truth → `docs/security-boundary.md`
- Protocol truth → `crypto-protocol.md` / `vault-revision.md` / `webauthn-prf.md` / `recovery.md`
- Roadmap in `docs/roadmap.md` is **stale** if it still says “no backend, no frontend.” Update it when you notice, in a docs-only commit if needed.

## Git hygiene

- One theme per branch. Close or rebase stale `cursor/*` clones.
- Do not merge empty Copilot “Initial plan” PRs.
- Commit messages: `feat|fix|harden|docs|test|ci` + area (`crypto`, `backend`, `pwa`, `webauthn`).
