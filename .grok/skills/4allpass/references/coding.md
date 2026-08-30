# Coding conventions

## Before the first edit

1. Name the **package**. UI does not touch `packages/crypto`. Broker policy stays in `@4allpass/core` (no secrets). The sidecar never decrypts.
2. Read a neighbor file in the same folder. Copy that pattern.
3. One theme, one branch. If PRs from this work are still open, follow [../../4allpass-next/SKILL.md](../../4allpass-next/SKILL.md).
4. Vault / first-run / Magpie / copy: also load [../../4allpass-ui/SKILL.md](../../4allpass-ui/SKILL.md).

## Default change shape

Smallest PR that:

1. Implements one invariant or one product slice.
2. Adds/extends tests in the matching package.
3. Updates the spec if the claim surface changed (`security-boundary.md` for “what runs”, protocol docs for “what must be true”).

Do not stack “also I refactored the PWA” onto a crypto PR.

## Which tests to run

Run the workspace that matches the diff. Do not skip it. Do not require the whole monorepo for a one-package slice.

| Change in | Command |
|---|---|
| `packages/crypto` | `npm test -w @4allpass/crypto` + typecheck. New behavior needs an `adversarial-*` test. |
| `packages/core` / access | `npm test -w @4allpass/core` |
| `packages/providers` | `npm test -w @4allpass/providers` |
| `packages/access` | `npm test -w @4allpass/access` |
| `extension/` | `npm test -w @4allpass/extension` |
| `frontend/src` | `npm test -w @4allpass/frontend` (or the one `*.test.ts`) + `npm run typecheck -w @4allpass/frontend` |
| `backend/` | `cd backend && pytest` |
| Claim surface | same PR updates `docs/security-boundary.md` and [claims.md](claims.md) |

Also: `npm run test:webauthn` when `packages/webauthn` or ceremony code moves.

```sh
npm test                    # full workspaces — before merge, not after every button
npm run typecheck
npm run test:webauthn
cd backend && pytest
```

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
- `vault-session.ts` is the sensitive module. Hard revoke / rotation belongs here, not in a random component. A Magpie/spacing PR does not edit it.
- Session token in `sessionStorage` is an accepted XSS trade (account, not vault). Don’t “fix” it by stuffing VK into `localStorage`.
- No new dependencies. No secrets in logs, test titles, or fixtures except marked dummies (`ghp_demo-…`).
- Keep pages thin: state in `frontend/src/hooks/vault/`, chrome in `frontend/src/components/vault/`.
- E2E: `frontend/e2e/` + virtual authenticator. Don’t claim PRF coverage from a mocked `prfSupported: true`.
- UI behavior: [../../4allpass-ui/SKILL.md](../../4allpass-ui/SKILL.md).

## Docs

- Implementation truth → `docs/security-boundary.md`
- Protocol truth → `crypto-protocol.md` / `vault-revision.md` / `webauthn-prf.md` / `recovery.md`
- Living roadmap is `ROADMAP.md`. `docs/roadmap.md` is not the status file.
- Claims: [claims.md](claims.md). Same PR if the claim surface moved.

## Git hygiene

- One theme per branch. Close or rebase stale `cursor/*` clones.
- Do not merge empty Copilot “Initial plan” PRs.
- Commit messages: `feat|fix|harden|docs|test|ci` + area (`crypto`, `backend`, `pwa`, `webauthn`).
- Follow `docs/git-workflow.md`. Agents open a PR; do not push to `main` unless the maintainer said so.
