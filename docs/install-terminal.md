# Plan — Terminal-Install (so wenig Klicks wie möglich)

Stand: 2026-08-24. **Script liegt in** [`scripts/install.sh`](../scripts/install.sh). Maintainer-Mac: **Intel (`x86_64`)**, macOS 15.  
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
2. **Nur** GitHub-Tag **`desktop`** (`/releases/tags/desktop`). Override: `FOURALLPASS_RELEASE=tag`. Nicht „erstes passendes Asset in der ganzen Release-Liste“.
3. Passendes Asset laden:  
   `4AllPass_*_x64.dmg` (Intel-Mac) · `4AllPass_*_aarch64.dmg` · `4AllPass_*_amd64.AppImage` · Windows `*_x64-setup.exe`.  
   Falsche CPU → Abbruch, nicht das ARM-DMG unter Intel starten. Script druckt **tag · Dateiname · SHA-256**.
4. SHA-256-Sidecar `${url}.sha256` laden. Hash der Datei muss matchen, sonst Abbruch. Die Asset-URL muss auf das Suffix **enden** (`*_x64.dmg`, nicht `*.dmg.sha256`).
5. **Mac:** DMG mounten → `4AllPass.app` nach `/Applications` → unmounten.  
   `xattr -cr /Applications/4AllPass.app` (Quarantäne weg = die 2 Rechtsklick-Klicks).  
   `open -a 4AllPass`.
6. **Linux:** nach `~/.local/bin/4allpass`, `chmod +x`, Datei starten.
7. Existiert die App schon: überschreiben. **Vault-Ordner nicht anfassen**  
   (`~/Library/Application Support/4AllPass/`, `%APPDATA%\4AllPass\`, `~/.local/share/4allpass/`).
8. Kein sudo. Scheitert `/Applications` (kein Schreibrecht): nach `~/Applications` und das sagen.

Rolling Prerelease-Tag **`desktop`** (nicht `v0.1.2`): `workflow_dispatch` oder der tägliche Cron (04:00 UTC) auf `.github/workflows/desktop.yml` hängt Intel/ARM-DMG, AppImage, NSIS und `*.sha256` an diesen Tag. Der Cron baut nur, wenn `main` neuer ist als der Tag. Der One-Liner lädt **genau diesen Tag**, nicht irgendein älteres `v*`. Signaturen/Notar kommen später ([#112](https://github.com/landjunge/4AllPass/issues/112)). Produktseite: [4allpass.netzwerkpunkt.de](https://4allpass.netzwerkpunkt.de/). Keine `.net`-Domain.

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
| 5 | CI schreibt `*.sha256` neben die Artefakte; `install.sh` / `install.ps1` prüfen | Tamper an der Datei → Abbruch |

Schritt 0 ist Voraussetzung für 1. Ohne Intel-DMG kein One-Liner auf diesem Mac. Kein Tag `v0.1.2` nur dafür — `workflow_dispatch` legt den rolling Prerelease-Tag `desktop` an (nicht `v*`).

---

## Definition of Done (dieser Plan)

- [x] `scripts/install.sh` — Mac Intel/arm64, Linux AppImage; Vault-Ordner unangetastet; `--suffix-only` / `--dry-run`.
- [x] README DE+EN: One-Liner zuerst; Satz „nicht notariert / du vertraust GitHub“.
- [x] Update überschreibt die App, lässt den Vault liegen (Script löscht Application Support nicht).
- [x] Unpassendes OS/CPU: klare Fehlermeldung.
- [x] FastAPI mintet weiterhin keine Tokens.
- [x] SHA-256-Sidecar in `desktop.yml`; Install-Script bricht bei Mismatch ab.
- [x] **Dieser Intel-Mac (2026-08-24):** `sh scripts/install.sh` → SHA-256 ok → `/Applications/4AllPass.app` → Fenster. Vault-Ordner unverändert (`Application Support/4AllPass`, bestehende `vault.db`).
- [ ] Phase A (#112) bleibt offen — Terminal-Install ist die Pause, nicht das Ende.

---

## Nächster Schritt (genau einer)

Terminal-Install auf diesem Intel-Mac ist geprüft. Fremder-Install und Apple-Doppelklick bleiben offen. GitHub-Live-Fill ist zwei explizite Fills (Username-Seite, dann Passwort-Seite) — kein Multi-Step-Engine.
