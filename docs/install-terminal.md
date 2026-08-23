# Plan — Terminal-Install (so wenig Klicks wie möglich)

Stand: 2026-08-23. **Plan, noch nicht gebaut.** Maintainer-Mac: **Intel (`x86_64`)**, macOS 15.  
Phase A (Apple-Notarisierung) bleibt pausiert ([#112](https://github.com/landjunge/4AllPass/issues/112)). Dieser Weg **ersetzt Apple nicht**. Er umgeht die Klicks, nicht Gatekeeper als Sicherheitsmodell.

`v0.1.1` hat nur `4AllPass_0.1.0_aarch64.dmg`. Das startet auf Intel **nicht** (Rosetta geht nur andersrum). Ohne `*_x64.dmg` ist der One-Liner auf diesem Mac wertlos.

Kein Core-Rewrite, kein zweites Tauri, kein `curl | sh`, der den Vault anfasst. FastAPI mintet keine Tokens.

---

## Ziel

Ein Mensch mit Terminal, der uns nicht kennt:

```text
einen Befehl einfügen  →  Enter  →  4AllPass-Fenster
```

**0 Extra-Klicks** bis das **Fenster** da ist. Danach entscheidet der User in der App (nicht still im Script): welche Browser-Extensions, ob Passwörter aus Profilen geholt werden. Keychain-Passwort nur beim Holen — [`browser-sync.md`](browser-sync.md).

Das ist die Installation für die Pause. Wenn Apple später da ist, bleibt derselbe Befehl — dann ohne Quarantäne-Trick, weil die App notariert ist.

---

## Heute (zu viele Klicks)

| Schritt | Klicks |
|---|---|
| Releases öffnen | 1 |
| Asset suchen | 1 |
| DMG laden | 1 |
| DMG öffnen | 1 |
| nach Programme ziehen | 1 |
| Finder → Programme | 1 |
| Rechtsklick → Öffnen → Öffnen | 2 |
| **Summe Mac ad-hoc** | **~8** |

Aus dem Repo bauen ist schlimmer (Node, Python, Rust, `tauri:build`). Das ist **nicht** der Fremden-Weg.

---

## Soll (ein Befehl)

**Mac (Intel zuerst — das ist dieser Rechner; Apple Silicon mit):**

```sh
curl -fsSL https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.sh | sh
```

**Linux:**

```sh
curl -fsSL https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.sh | sh
```

**Windows (danach, PowerShell):**

```powershell
irm https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.ps1 | iex
```

Ein Script, OS wird erkannt. Kein Homebrew-Tap, kein `npm`, kein Compiler.

---

## Was das Script tut (genau)

Datei: `scripts/install.sh` (POSIX `sh`).

1. OS + CPU erkennen. Unbekannt → eine Zeile Fehler, Exit 1.  
   Zuerst: **macOS Intel (`x86_64` → `*_x64.dmg`)**. Mit: **macOS arm64** (`*_aarch64.dmg`), **Linux x86_64**. Windows in Schritt 4.
2. Neueste GitHub-Release finden (`/repos/landjunge/4AllPass/releases`, inkl. Prerelease — „latest“ ignoriert Pre).
3. Passendes Asset laden:  
   `4AllPass_*_x64.dmg` (Intel-Mac) · `4AllPass_*_aarch64.dmg` · `4AllPass_*_amd64.AppImage` · später `*_x64-setup.exe`.  
   Falsche CPU → Abbruch, nicht das ARM-DMG unter Intel starten.
4. **Mac:** DMG mounten → `4AllPass.app` nach `/Applications` → unmounten.  
   `xattr -cr /Applications/4AllPass.app` (Quarantäne weg = die 2 Rechtsklick-Klicks).  
   `open -a 4AllPass`.
5. **Linux:** nach `~/.local/bin/4allpass`, `chmod +x`, Datei starten.
6. Existiert die App schon: überschreiben. **Vault-Ordner nicht anfassen**  
   (`~/Library/Application Support/4AllPass/`, `%APPDATA%\4AllPass\`, `~/.local/share/4allpass/`).
7. Kein sudo. Scheitert `/Applications` (kein Schreibrecht): nach `~/Applications` und das sagen.

Optional später, nicht im ersten Schnitt: SHA-256 der Release-Assets prüfen.

---

## Ehrlichkeit (README, DE+EN, im Script-Kopf)

- Nicht notariert. Nicht SmartScreen-clean.
- `xattr` = dasselbe Vertrauenslevel wie Rechtsklick → Öffnen, nur ohne Dialog.
- Du vertraust **diesem GitHub-Repo** und dem Release-Binary.
- `curl | sh` ist ein Vertrauensakt. Alternative ohne Pipe: Script speichern, lesen, `sh install.sh`.
- Unlock bleibt das Tresor-Passwort. Kein Auto-Allow.

---

## Was wir nicht tun

| Idee | Warum nicht |
|---|---|
| Homebrew-Tap / Cask | Extra-Repo, Review, wartet auf Notarisierung |
| From-source als Install (`npm i` + `tauri:build`) | Minuten, Toolchain, nicht für Fremde |
| `npm run app` als Produkt-Install | Dev-Pfad, braucht Clone + Node + Python |
| Quarantäne **nicht** entfernen | Dann wieder Rechtsklick — der Plan ist wertlos |
| Vault bei Install/Update löschen | Verboten |
| Eigenes Download-Domain-Setup | Roh GitHub reicht |

---

## Bau-Reihenfolge

| # | Stück | Fertig wenn |
|---|---|---|
| 0 | CI: `macos-15-intel` zusätzlich zu `macos-latest` | Release enthält `4AllPass_*_x64.dmg` **und** `*_aarch64.dmg`. Sidecar nicht cross-compilen — Job muss auf Intel laufen. |
| 1 | `scripts/install.sh` — Mac Intel, dann arm64 | Auf **diesem** Intel-Mac: Befehl → Fenster, 0 Extra-Klicks |
| 2 | README „Einrichten“: One-Liner **oben**, DMG darunter, From-source ganz nach unten | 3 Zeilen lesen genügen |
| 3 | Linux AppImage-Zweig im selben Script | Ein Befehl, App startet |
| 4 | `scripts/install.ps1` Windows | Ein Befehl; SmartScreen kann noch warnen (kein Zertifikat) |
| 5 | CI schreibt SHA-256 neben die Artefakte; Script prüft | Tamper an der Datei → Abbruch |

Schritt 0 ist Voraussetzung für 1. Ohne Intel-DMG kein One-Liner auf diesem Mac. Kein Tag `v0.1.2` nur dafür — `workflow_dispatch` auf `desktop.yml` reicht für ein Test-Artefakt.

---

## Definition of Done (dieser Plan)

- [ ] **Dieser Intel-Mac** (Terminal, kein Extra-Klick): **ein** Befehl, App-Fenster, kein Rechtsklick.
- [ ] Apple-Silicon-Mac: derselbe Befehl, holt `aarch64`.
- [ ] README DE+EN: One-Liner zuerst; Satz „nicht notariert / du vertraust GitHub“.
- [ ] Update überschreibt die App, lässt den Vault liegen.
- [ ] Intel-Mac / unpassendes OS: klare Fehlermeldung, kein halbes Install.
- [ ] FastAPI mintet weiterhin keine Tokens.
- [ ] Phase A (#112) bleibt offen — Terminal-Install ist die Pause, nicht das Ende.

---

## Nächster Schritt (genau einer)

CI Intel-Job (`macos-15-intel`) mergen, per `workflow_dispatch` ein `*_x64.dmg` erzeugen.  
Dann `scripts/install.sh` auf **diesem Intel-Mac** prüfen. Erst danach Linux.
