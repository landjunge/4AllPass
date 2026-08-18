# 4AllPass Frontend

React + TypeScript + PWA (Vite). See the repo-root docs for the authoritative crypto and
architecture specs:

- [`../docs/architecture.md`](../docs/architecture.md)
- [`../docs/webauthn-prf.md`](../docs/webauthn-prf.md)
- [`../docs/backend-security-boundary.md`](../docs/backend-security-boundary.md)

## What lives here (v1 scaffold)

- `src/lib/webauthnPrf.ts` — the WebAuthn PRF device-unlock construction from
  `docs/webauthn-prf.md`, built directly on `@4allpass/crypto`'s
  `prfEvalFirst`, `deriveDeviceWrappingKey`, `wrapDeviceKey`, and
  `unwrapDeviceKey`. The pure register/unlock core is unit tested
  (`webauthnPrf.test.ts`); the `navigator.credentials` glue at the bottom of
  the file is not (it needs a real authenticator).
- `src/lib/accountAuth.ts` — account sign-in against the backend session API.
  `fetch` is injectable, so the client is unit tested without a browser
  (`accountAuth.test.ts`).
- A minimal account sign-in screen followed by the "vault locked" screen
  (`src/App.tsx`), wiring the Master Password and biometric-unlock entry points.
  Vault unlock itself is still not connected to a backend — snapshot fetch and
  commit are the next backend milestone.
- PWA manifest + service worker via `vite-plugin-pwa` (`vite.config.ts`).

## Authentication state is not vault state

```
Authentication:  user            -> backend session (an HttpOnly cookie)
Vault:           encrypted data  -> client-side crypto -> plaintext
```

The two are kept apart on purpose:

- There is **no token to store**. The session token lives in a cookie script
  cannot read, so nothing goes into `localStorage` or `sessionStorage`. "Am I
  signed in?" is answered by `GET /auth/me`, not by something we wrote down.
- Every request sets `credentials: 'include'`, which is the only thing the
  client has to get right for cookie auth to work.
- Signing in never yields the Vault Key. The Master Password stays in the tab
  that typed it and is never sent anywhere.

Set `VITE_API_BASE_URL` only for a split deployment; the self-hosted default is
same-origin. A cross-origin API must list the app's origin in
`FOURALLPASS_CORS_ORIGINS`.

## Local setup

```sh
npm install        # from the repo root (npm workspaces)
npm run dev -w @4allpass/frontend
```

## Tests

```sh
npm run test -w @4allpass/frontend        # pure WebAuthn/PRF core logic
npm run typecheck -w @4allpass/frontend
npm run build -w @4allpass/frontend
```
