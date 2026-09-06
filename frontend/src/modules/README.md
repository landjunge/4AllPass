# Frontend module boundaries

This directory is the target structure for the incremental extraction from
`state/app-state.tsx`. Phase 1 established the boundaries without moving
business logic. Later phases migrate one responsibility at a time.

## Rules

1. Every module exposes its public API only through its `index.ts`.
2. A module may use its own internal folders.
3. Imports from another module must target that module's public entry point.
4. No module owns cryptographic formats, snapshot formats, CAS, or key versions.
5. Existing code remains in place until its dedicated, tested migration PR.
6. One responsibility is migrated per PR.

The root command `npm run check:module-boundaries` rejects cross-module
deep imports.

## Migration order

`feedback → account → startup/app-shell → vault-lifecycle → recovery → entries
→ import/browser-profiles → autofill → devices → sharing → settings/agent-access
→ desktop-adapter`.
