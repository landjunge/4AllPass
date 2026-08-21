# 4AllPass — agent instructions

For reviews, implementation, and “how do we improve this”, open
[`.cursor/skills/4allpass/SKILL.md`](.cursor/skills/4allpass/SKILL.md) first.

`docs/` is authoritative. `docs/security-boundary.md` describes what the
running backend and PWA actually enforce.

## Cursor Cloud specific instructions

Environment `install` is `./scripts/cloud-agent-install.sh` (`npm ci` plus
backend/scripts pip requirements). Recurring builds fail unless the
allowlist includes `registry.npmjs.org`, `registry.npmjs.com`, `pypi.org`,
and `files.pythonhosted.org`. A blocked registry looks like npm
`Exit handler never called!`, not a lockfile error.
