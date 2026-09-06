# 4AllPass Frontend

React + TypeScript + PWA (Vite). See the repo-root docs for the authoritative crypto and
architecture specs:

- [`../docs/architecture.md`](../docs/architecture.md)
- [`../docs/webauthn-prf.md`](../docs/webauthn-prf.md)

## Local setup

```sh
npm install        # from the repo root (npm workspaces)
npm run dev -w @4allpass/frontend
```

## Tests

```sh
npm run test -w @4allpass/frontend        # unit tests
npm run test:e2e -w @4allpass/frontend    # Playwright + virtual authenticator
npm run test:e2e:user-watch -w @4allpass/frontend  # V0–V8 dummy vault, screenshots
npm run typecheck -w @4allpass/frontend
npm run build -w @4allpass/frontend
```

E2E tests drive the backend (PostgreSQL, Redis, uvicorn) and Chrome's virtual
authenticator. They flip `hasPrf` / `hasLargeBlob` to cover all three unlock
ranks.

## Flows

**Create vault.** Reserve a `vault_id`, generate a random Vault Key, derive the
Master Key with Argon2id, wrap master + recovery envelopes, commit revision 1.

**Unlock.** Fetch `active_revision`, refuse a rollback against the local pin,
unwrap the Vault Key, verify snapshot integrity, decrypt into memory.

**Device unlock.** `@4allpass/webauthn` provisions the best rank (PRF, largeBlob,
UV-gated local store). Unlock is assertion → DWK → Device Key → Vault Key.
Master password always remains a fallback.

## Lock lifecycle

The Vault Key is zeroized on lock. In the PWA and in `4AllPass.app` that is
the Lock button only — not sleep, screen lock, tray, idle, or a hidden tab.
JavaScript cannot guarantee erasure of every copy; that limit is accepted in
the threat model.
