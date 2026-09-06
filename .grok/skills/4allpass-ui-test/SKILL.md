---
name: 4allpass-ui-test
description: >
  Opt-in UI-Test-Suite for 4AllPass. Use only when the user attaches the
  Design-Protokoll, says UI-Test-Suite, Design-Protokoll, or Zusatzprompt UI.
  Not CI. Not always-on. Load 4allpass and 4allpass-ui first. Dummy vault only.
---

# UI-Test-Suite (opt-in)

Volltext: [../../../docs/UI_TEST_SUITE.md](../../../docs/UI_TEST_SUITE.md).

Load [../4allpass/SKILL.md](../4allpass/SKILL.md) and [../4allpass-ui/SKILL.md](../4allpass-ui/SKILL.md).

Do not start this suite unless the current user message names it. Default 4AllPass work does **not** include this walk.

## Do

1. Isolated data dir, headed, mouse + keyboard. `npm run test:e2e:user-watch`.
2. Walk `docs/ui-map.md` V0–V8.
3. Auto-fix the Missverständnis list and dead scroll/ellipsis/clicks. Re-run that step.
4. Pause on taste: screenshot + one line, wait.

## Do not

Retoken Magpie to Gnom-Grau. Build Eve / S-key. Split provider cards. Touch Daniel’s vault. Schedule or CI.
