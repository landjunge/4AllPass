# 4AllPass — Claude Code

Lies zuerst diese Datei. Prüfe danach `frontend/src/tokens.css` und `frontend/src/styles.css`.

Dann:

1. [AGENTS.md](AGENTS.md)
2. Skill [`.claude/skills/4allpass/SKILL.md`](.claude/skills/4allpass/SKILL.md) (zeigt auf `.cursor/skills/4allpass`)
3. Bei „weiter / nächster Schritt / improve“: `.grok/skills/4allpass-next/SKILL.md`
4. Bei Tresor-UI / Magpie / normale User: `.grok/skills/4allpass-ui/SKILL.md`

`docs/security-boundary.md` beschreibt, was der laufende Code erzwingt. Specs gewinnen gegen PR-Text.

Palette: `frontend/src/tokens.css` (Golden Magpie). Nicht Gnom-Hub, nicht die alte Blau-Tabelle in `DESIGN.md`.

Nicht den Benutzerordner als Workspace. Andere Repos: eigene Sitzung oder `/add-dir`, nie `$HOME`.

**Tresor öffnen:** nur Desk-App, Flag Pflicht:

```sh
bash scripts/open-desktop.sh --desktop
```

Nie `http://127.0.0.1:8788` im Browser als „dein Tresor“. Das ist `npm run app`, nicht die Desk-App.
