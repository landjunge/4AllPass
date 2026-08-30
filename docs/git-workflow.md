# 4AllPass — Git Workflow

**Stand:** 2026-08-25  
**Für:** Daniel Filipek (landjunge) + Agents  
**Status:** Verbindlich für Solo- und Agent-Entwicklung

## Prinzipien

- `main` ist immer grün und das Produkt.
- Ein Theme pro Branch / PR.
- Specs (`docs/`) und Code gehören zusammen, wenn sich Claims ändern.
- Zero-Knowledge und die Security-Boundary sind nicht verhandelbar.
- Agents öffnen immer einen PR (außer der Koordinator sagt explizit „direkt auf main“).

## Branching

| Prefix       | Verwendung                              | Lebensdauer     |
|--------------|-----------------------------------------|-----------------|
| `feat/`      | Neues Verhalten                         | kurz (< 5 Tage) |
| `fix/`       | Bugfix                                  | kurz            |
| `docs/`      | Dokumentation                           | sehr kurz       |
| `harden/`    | Security / Crypto / CAS / Claims        | kurz            |
| `ci/`        | Workflows, Dependabot, Tools            | kurz            |
| `chore/`     | Aufräumen, non-crypto Dependencies      | kurz            |
| `test/`      | Nur Tests                               | kurz            |
| `refactor/`  | Strukturverbesserungen ohne Verhaltensänderung | kurz     |

- Keine long-lived `develop` oder `release/*` Branches.
- Vor dem Merge auf aktuellen `main` rebasen (bevorzugt).
- Force-push nur auf dem eigenen Feature-Branch erlaubt.
- Squash-Merge ist der Standard für saubere History.

## Commit Messages

Conventional Commits (Pflicht):

```
feat(extension): reliable field intelligence for github-shaped logins
fix(broker): reject non-loopback origins with 403
docs(human): add README for normal people (DE+EN)
harden(crypto): bind vaultKeyVersion in every AAD
test(crypto): adversarial mixed-snapshot cases
ci: run sqlite backend tests on every PR
chore: bump non-crypto npm deps
```

## Pull Requests

- Immer das PR-Template ausfüllen.
- Ein Theme pro PR. Lieber zwei kleine als einen großen.
- Docs-only und klare Hardening-PRs: nach grünem CI Self-merge erlaubt.
- Crypto, Backend-CAS, Security-Boundary, Access-Broker: Specs im **selben** PR aktualisieren.
- Dependabot-PRs: nach grünem CI squash-mergen (außer Crypto-Libs).

## Agents (Grok-Team / Cursor / etc.)

- **Immer** einen PR öffnen.
- Nie direkt auf `main` pushen, außer der Koordinator (Daniel Filipek) sagt ausdrücklich „direkt auf main“.
- Branch-Name klar und beschreibend.
- PR-Body mit dem Template füllen und die Checkliste ehrlich abhaken.

Auf **diesem** Mac: `scripts/install-git-hooks.sh` setzt einen `post-commit`-Hook, der nach jedem Commit pusht (sonst bleibt Arbeit nur lokal). GitHub kann dabei schreiben: „Bypassed rule violations / required status checks“ — das ist **kein** kaputtes Git. Der Push ist durch, CI läuft danach. Echter Fehler nur, wenn der Hook `post-commit: push … failed` sagt.

## Releases

- Tag `desktop` = rolling Prerelease (Desktop-Builds via `workflow_dispatch` oder täglich 04:00 UTC, nur wenn `main` sich geändert hat).
- Tags `v*` = versionierte Releases.
- Desktop-Builds laufen bewusst **nicht** auf jedem PR (zu langsam).
- Apple-Notarisierung bleibt pausiert, bis das Developer-Abo läuft.

## Empfohlene Branch Protection (GitHub UI)

Für `main`:

- Require a pull request before merging
- Require status checks to pass (CI)
- Require linear history (oder squash)
- Do not allow force pushes
- Restrict who can push (nur landjunge)

Das schützt vor versehentlichem Broken-Main. Direkt-Push auf `main` (dieser Hook) umgeht die Checks mit Admin-Rechten; CI muss trotzdem grün werden. Nicht mit einem Git-Fehler verwechseln.
