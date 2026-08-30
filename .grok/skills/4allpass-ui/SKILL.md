---
name: 4allpass-ui
description: >
  Vault UI for normal people. Use when changing the 4AllPass desk, first-run,
  unlock, import review, copy, empty states, Magpie chrome, onboarding, or when
  the user says Tresor-UI, für normale User, or usable vault. Load 4allpass
  first. Do not start vault UI work without this skill.
---

# 4AllPass UI — normal users

Load [../4allpass/SKILL.md](../4allpass/SKILL.md) first. Claims:
[../4allpass/references/claims.md](../4allpass/references/claims.md).
Code shape: [../4allpass/references/coding.md](../4allpass/references/coding.md).

The human path is **Install → Import → Autofill**. They do not need crypto,
CAS, or revision numbers.

## Authority

```text
docs/ui-map.md                 one question per surface (V0–V8)
docs/screenshots/*.html        numbered wireframes
frontend/src/tokens.css        Golden Magpie — the running palette
frontend/src/components/vault/ reuse these
frontend/src/pages/            Auth, Create, Unlock, Restore, Vault
```

`DESIGN.md` still shows an old blue table as “Current Colors”. **Ignore it.**
`tokens.css` wins. Never Gnom-Hub greys.

## Non-negotiable

1. **One question per surface.** New surface → number it in `ui-map.md` first, then code.
2. **First screen is Tresor**, not Zugriff, not Einstellungen. Tabs stay Tresor · Browser · Zugriff · Einstellungen.
3. **Plain language default** via `useCopy()` / `t({ de, en }, expert?)`. Expert copy only behind the switch. DE+EN in the same PR.
4. **No everyday crypto.** No revision, CAS, `vaultKeyVersion` on the desk. Those live under Einstellungen → Sicherheit. `sr-only` test ids on the tab bar may stay.
5. **No secrets on the surface.** Import review: host + username, never a password column. Lists mask usernames. Overlays and `console` never print values.
6. **Honest first-run.** Desktop: Create or Unlock. Recovery kit is not skippable. `POST /auth/register` 409 → sign in, do not silently register again. Local profile shows no fake email.
7. **Reuse.** `frontend/src/components/vault/*`. No second desk chrome. No new npm dependencies.
8. **Narrow viewport:** columns stack under 820 px.
9. **Empty / error:** one primary action + cancel. Banner can be dismissed. Empty desk offers Login anlegen / Import, not a blank card.
10. Access overlay: Allow copies a **raw secret** in v1. Do not write “the password stays in the vault” after Allow.

## How to change UI

1. Name the view (V0–V8) and open the matching wireframe.
2. Edit the existing component. Do not add a parallel tree.
3. Copy through `t(...)`.
4. `npm run typecheck -w @4allpass/frontend` and the affected `frontend/src/**/*.test.ts`.
5. Exercise the path (Playwright local or a real window). A static screenshot is not verification.

## Do not

- New tabs or Access-as-home
- Password in import/list UI
- Mix Magpie spacing into a `packages/crypto` PR
- Bring back a Welcome screen
- Shadow DOM / multi-step autofill in a UI polish PR
- Gnom-Hub tokens or mixing the 4AllPass mark with other products
