# Frontend module boundaries

This directory contains the completed module structure extracted incrementally from the former central app state.

## Rules

1. Every module exposes its public API only through its `index.ts`.
2. A module may use its own internal folders.
3. Imports from another module must target that module's public entry point.
4. No module owns cryptographic formats, snapshot formats, CAS, or key versions unless that responsibility already belongs to the lower crypto/core layer.
5. Compatibility files under `frontend/src/lib/` may temporarily re-export a module API for older callers; new module-to-module code must use the module entry point.
6. Keep responsibilities separated so changes can be tested and rolled back independently.

The root command `npm run check:module-boundaries` rejects cross-module deep imports.

## Completed migration

`feedback → account → startup/app-shell → vault-lifecycle → recovery-management → entries
→ import/browser-profiles → autofill → devices/device-management → sharing
→ settings/agent-access → desktop-adapter`.

The migration was completed in small PRs with CI, CodeQL and secret scanning required before merge.

## Final responsibilities

- `app-shell`: composition, feedback wiring, and the stable public app API.
- `account`: sign-in, sign-up, local-session and account-password separation.
- `startup`: startup/session restoration and local-store status.
- `vault-lifecycle`: vault selection, create/restore, lock/unlock, import into the open vault and entry commits.
- `device-management`: biometrics, device listing and revoke orchestration.
- `devices`: stable local device identity and WebAuthn RP/device description helpers.
- `recovery-management`: trusted-recovery replacement and compromised-recovery rotation.
- `entries`: plaintext entry schema and client-side entry helpers.
- `import`: public import boundary for existing import parsing/merge behavior.
- `browser-profiles`: browser/profile discovery, browser import and local activation state.
- `autofill`: frontend autofill-domain helpers; the extension engine remains separate.
- `sharing`: selective encrypted share-package build/open/download behavior.
- `settings`: settings-domain copy and related frontend settings surface.
- `agent-access`: frontend agent-access adapter and demo walkthrough; policy remains in `@4allpass/core`.
- `desktop-adapter`: optional Tauri/autostart/event adapter with no vault-secret ownership.

Do not move crypto protocol ownership, CAS semantics, sealed snapshot formats or key-version rules into these UI modules.
