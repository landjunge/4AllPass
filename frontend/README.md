# 4AllPass Frontend

React + TypeScript + PWA (Vite). See the repo-root docs for the authoritative crypto and
architecture specs:

- [`../docs/architecture.md`](../docs/architecture.md)
- [`../docs/webauthn-prf.md`](../docs/webauthn-prf.md)

## What lives here (v1 scaffold)

- `src/lib/webauthnPrf.ts` — the WebAuthn PRF device-unlock construction from
  `docs/webauthn-prf.md`, built directly on `@4allpass/crypto`'s
  `prfEvalFirst`, `deriveDeviceWrappingKey`, `wrapDeviceKey`, and
  `unwrapDeviceKey`. The pure register/unlock core is unit tested
  (`webauthnPrf.test.ts`); the `navigator.credentials` glue at the bottom of
  the file is not (it needs a real authenticator).
- A minimal "vault locked" screen (`src/App.tsx`) wiring the Master
  Password and biometric-unlock entry points. Neither is connected to a
  running backend yet — there is no account/session/vault API to unlock
  against in this scaffold.
- PWA manifest + service worker via `vite-plugin-pwa` (`vite.config.ts`).

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
