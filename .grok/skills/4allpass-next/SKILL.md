---
name: 4allpass-next
description: >
  Decide the next 4AllPass action. Use when the user says weiter, nächster
  Schritt, improve 4AllPass, was jetzt, Grok Build, or asks what to build next.
  Lands open PRs and names the human proof before starting a new code slice.
---

# 4AllPass — next

Load [../4allpass/SKILL.md](../4allpass/SKILL.md) first if you have not.

This skill is **steering**, not a license to implement Secret Access Layer A–F.

## Algorithm (strict order)

### 1. Open work

List open PRs on `landjunge/4AllPass`. If this session (or the maintainer) already
opened slices that are not on `main`, **land or close them** before a new theme
branch.

As of 2026-08-30, land in this order when still open:

1. `#151` docs honesty (Tauri, raw-secret, P1, hygiene)
2. `#150` detect + ask, never silent fill
3. `#152` `handoff: mediated` DENY in v1

Do not open a fourth parallel branch for the same access/docs theme.

Use `/pr-babysit` or rebase/CI fixes if a PR is red. Do not start Slice N+1.

### 2. Authority

```text
docs/security-boundary.md     what the running code enforces
        ↓
ROADMAP.md                    living status (one file)
        ↓
docs/grok-build-plan.md       Grok entry — must not override the boundary
        ↓
docs/product-maturity.md      product sequence
```

If `grok-build-plan.md` says “build Phase 4 MAIP” and `security-boundary.md` /
`ROADMAP.md` say MAIP is later: **do not build MAIP**.

### 3. After `main` is current

Default is **no new code**.

Next product proof: [#120](https://github.com/landjunge/4AllPass/issues/120) —
stranger Mac: app opens, vault, browser cards, import review without passwords.
Checklist: `docs/freeze.md`.

Human blockers that stay paused until the maintainer pays/asks:

- [#112](https://github.com/landjunge/4AllPass/issues/112) Apple notarization
- [#38](https://github.com/landjunge/4AllPass/issues/38) third-party audit

### 4. New code only when something broke or was asked

One slice, one branch, spec in the same PR if claims moved.
Follow [../4allpass/references/coding.md](../4allpass/references/coding.md).

Propose **one** item, say why, wait if the user only asked “what next”.

### 5. Do not start

- MAIP / cryptographic agent identity
- Robot / MHS / Policy-Freigabe (parked: `docs/architecture/agent-access.md` § Headless)
- Always-allow, env export, credential proxy
- Autofill expansion on suspicion (Shadow DOM, multi-step, iframe)
- Native mobile before PWA
- Docs reorganization
- Fifth parallel branch for the same theme
- Reimplementing anything already on `main` (see `docs/product-maturity.md` DoD)

## Output when the user says „weiter“

1. Open PRs (numbers + one-line status).
2. Recommended action: merge / rebase / human test / **one** slice.
3. What you will **not** do.
