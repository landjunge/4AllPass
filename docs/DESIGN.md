# 4AllPass – Design Foundation

> Basis-Info, damit nichts verloren geht (Stand 2026-08-28).

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

## 4AllPass Tresor-Chrome (Golden Magpie)

Der Tresor ist die 4AllPass-Marke, nicht Gnom-Hub-Grau. Quelle: `frontend/src/tokens.css`. Radius, Schatten, Focus-Ring bleiben Desk-Chrome.

| Token | Wert | Rolle |
|---|---|---|
| `--bg` | `#0A0E1A` | Fläche |
| `--bg-panel` | `#0E1424` | Header / Inputs |
| `--bg-card` / `--panel` | `#12182B` | Karten |
| `--bg-elev` | `#1A2238` | angehoben |
| `--text` | `#F8F4EC` | Titel |
| `--text-muted` / `--muted` | `#A89F8C` | Username, Meta |
| `--border` | `#2A3348` | Kanten |
| `--accent` / `--accent-hi` | `#C9A227` / `#D4AF37` | Gold, Primary, Stern an |
| `--ok` / `--warn` / `--err` | `#3DDC97` / `#C9A227` / `#ff7a90` | Health / Status / Leak |

Gnom-Hub-V1-Grau (`#121316` / Accent `#6b7280`) gilt für **Gnom-Hub-V1 und Tollgate Control Room**, nicht für diesen Tresor. **Kein Rainbow-Chrome.** Agent-Farben nur in Gnom-Hub-V1.

Logos bleiben produktspezifisch (4AllPass-Elster, Gnom-G, Tollgate-Marke).

Aktuelles Logo: Elster mit goldenem Schlüssel auf dem Schriftzug (`frontend/public/logo.png`). App-Icon: Elster allein (`icon-512.png`).

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

„Golden Magpie“ (`#C9A227`) ist Accent **und** Logo-Schlüssel. Primary-Buttons und der Favoriten-Stern nutzen Gold. `--warn` ist dasselbe Gold als Status, nicht als zweite Marke.

## Logo netzwerkpunkt.de (neu)

Portfolio-Logo wird separat entwickelt (siehe Canva / spätere Varianten).  
Konzept-Richtung: zentraler „Punkt“ / Node in einem Netzwerk – klar, modern, KI-/Multi-Agent-tauglich, ohne Verwechslung mit 4AllPass-Elster.

## Nächste Schritte

1. Logo-Varianten in Canva bleiben editierbar; PWA/Extension nutzen die Elster-PNGs
2. 4AllPass-Tokens bleiben Magpie. Gnom-Hub-V1-Grau nicht zurückmischen
3. Tollgate Control Room bleibt auf Gnom-Hub-V1-Tokens
4. Optional Light-Mode — nur wenn derselbe Desk ihn hat
5. 4AllPass + korrekte **Gnom-Hub-V1**-Bezeichnung auf netzwerkpunkt.de eintragen
6. Logo für netzwerkpunkt.de finalisieren

---
*Angelegt als permanente Design-Basis im Repo. Gnom-Namensregel verbindlich.*
