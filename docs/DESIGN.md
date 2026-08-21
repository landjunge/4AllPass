# 4AllPass – Design Foundation

> Basis-Info, damit nichts verloren geht (Stand 2026-08-20, korrigiert).

## Portfolio / Domain

- **Hauptdomain:** [netzwerkpunkt.de](https://netzwerkpunkt.de)
- Dort sollen alle Projekte, Apps, Webseiten und Portfolio-Items gebündelt werden.
- 4AllPass gehört als weiteres Projekt unter dieses Dach.

### Namensregel – Gnom (KRITISCH, nicht mehr verdrehen)

| Korrekt | Status |
|---------|--------|
| **Gnom-Hub-V1** | Einziger korrekter und aktueller Name + Repo |

Es existieren mehrere Repos mit „Gnom“-Varianten im Namen (`gnom-hub`, `Gnom-Hub-Clean`, `gnom-hub-v2`, …).  
**Nur `Gnom-Hub-V1` / `gnom-hub-v1` ist momentan richtig und relevant.**  
Alle anderen Bezeichnungen (Gnom-Hub, Gnom Hub, Gnom-Hub-V2 usw.) sind veraltet oder falsch und führen zu Verwirrung.  
Diese Regel gilt verbindlich für Dokumentation, Portfolio-Seite und Agent-Antworten – damit der Owner nicht immer wieder korrigieren muss.

## Gemeinsames Desk-Chrome (alle Tools)

**Basis ist Gnom-Hub-V1**, nicht eine eigene 4AllPass-Palette und nicht das alte Neon-Hub.

**Immer Gnom-Hub-V1** — Name, Desk und Farben. Nicht Orange vom Portfolio, nicht das alte Neon-Hub.

Quelle: `gnom-hub-v1/src/gnom_hub/ui/static/app.css` `:root`  
Veröffentlicht: https://netzwerkpunkt.de/assets/desk-tokens.css  
Lokale Kopie: `frontend/src/tokens.css` (offline, kein Extra-Origin).

| Token | Wert | Rolle |
|---|---|---|
| `--bg` | `#121316` | Fläche |
| `--bg-panel` | `#1a1b1f` | Header / Inputs |
| `--bg-card` | `#1e1f24` | Karten |
| `--bg-elev` | `#24262d` | angehoben |
| `--text` | `#e2e4e9` | Text |
| `--text-muted` | `#8b909a` | sekundär |
| `--border` | `#2e3138` | Kanten |
| `--accent` / `--accent-hi` | `#6b7280` / `#a1a8b3` | ruhiges Chrome |
| `--ok` / `--warn` / `--err` | `#3d9b6a` / `#c9a227` / `#c45c5c` | Status |

Gleiche Tokens für 4AllPass PWA, Extension-Popup und Tollgate Control Room. **Kein Rainbow-Chrome.** Agent-Farben nur in Gnom-Hub-V1 (Identität der Agenten).

Logos bleiben produktspezifisch (4AllPass-Elster, Gnom-G, Tollgate-Marke).

Aktuelles Logo: Elster mit goldenem Schlüssel auf dem Schriftzug (`frontend/public/logo.png`). App-Icon: Elster allein (`icon-512.png`). Chrome bleibt Gnom-Hub-V1.

## Logo-Brief 4AllPass

4AllPass bekommt ein eigenes Logo:

- **Schriftzug:** „4AllPass“
- **Motiv:** eine Elster (Magpie / *Pica pica*), die **auf dem Schriftzug sitzt**
- **Ansicht:** Vorderansicht (frontal)
- **Attribut:** hält einen **goldenen Schlüssel** im Schnabel

Symbolik: Elster = klug, sammelt glänzende Dinge → Passwörter / Keys / Secrets. Goldener Schlüssel = Zugang, Sicherheit, Zero-Knowledge.

Canva-Kandidaten (editierbar im Account):
- [Modern '4AllPass' Logo with Alert Magpie](https://www.canva.com/d/TgTiGOX87wFWhrW)

## Logo-Farbe vs. Chrome

„Golden Magpie“ (`#C9A227`) gilt **nur für das 4AllPass-Logo** (Schlüssel / Elster), nicht für App-Chrome. Chrome folgt Gnom-Hub-V1. `--warn` in der Desk-Palette ist bewusst dasselbe Gold, als Status, nicht als Button-Fill.

## Logo netzwerkpunkt.de (neu)

Portfolio-Logo wird separat entwickelt (siehe Canva / spätere Varianten).  
Konzept-Richtung: zentraler „Punkt“ / Node in einem Netzwerk – klar, modern, KI-/Multi-Agent-tauglich, ohne Verwechslung mit 4AllPass-Elster.

## Nächste Schritte

1. Logo-Varianten in Canva bleiben editierbar; PWA/Extension nutzen die Elster-PNGs
2. Desk-Tokens nicht anfassen — Gold nur im Logo / `--warn`
3. Tollgate-Marketing-Site (`site/styles.css`) weiter auf dieselben Tokens ziehen
4. Optional Light-Mode — nur wenn Gnom-Hub-V1 ihn hat
5. 4AllPass + korrekte **Gnom-Hub-V1**-Bezeichnung auf netzwerkpunkt.de eintragen
6. Logo für netzwerkpunkt.de finalisieren

---
*Angelegt als permanente Design-Basis im Repo. Gnom-Namensregel verbindlich.*
