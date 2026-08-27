# 4AllPass — agent instructions

For reviews, implementation, and “how do we improve this”, open
[`.cursor/skills/4allpass/SKILL.md`](.cursor/skills/4allpass/SKILL.md) first
(or `.grok/skills/4allpass/SKILL.md` if that copy is present).

`docs/` is authoritative. `docs/security-boundary.md` describes what the
running backend and PWA actually enforce.

## 4AllPass Tresor-UI

Vor jeder Änderung am Tresor: lies `.grok/skills/4allpass/SKILL.md`
(oder `.cursor/skills/4allpass/SKILL.md`), `DESIGN.md`,
[`docs/architecture.md`](docs/architecture.md), [`docs/ui-map.md`](docs/ui-map.md)
und die bestehenden Komponenten unter `frontend/src/components/vault/`.

- Wiederverwenden statt neu erfinden.
- Golden-Magpie-Palette aus DESIGN.md, nicht die Gnom-Hub-Tokens.
- Keine neuen Dependencies, keine Crypto-Änderungen.
- Typecheck + Tests im frontend-Workspace vor dem Commit.
- Keine Secrets im Diff.
- Immer committen und auf den aktuellen Branch pushen. Nicht auf Nachfrage warten.
