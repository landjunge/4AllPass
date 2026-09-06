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

## Gemeinsame Desktop-Richtung: Gnom-Hub-V1-Grau

Gnom-Hub-V1 ist die bestätigte visuelle Richtung für 4AllPass und die weiteren NetzwerkPunkt-Apps und -Tools. Gemeinsame Grundlage sind dunkles Grau, kompakte Abstände, Karten, Dialoge, Eingaben und Fokuszustände. Die Produkte bleiben technisch eigenständig und behalten eigene Namen und Logos.

Quelle für den laufenden 4AllPass-Tresor ist `frontend/src/tokens.css`.

| Token | Wert | Rolle |
|---|---|---|
| `--bg` | `#121316` | Hauptfläche |
| `--bg-panel` | `#1a1b1f` | Header / Inputs |
| `--bg-card` / `--panel` | `#1e1f24` | Karten |
| `--bg-elev` | `#24262d` | angehobene Flächen |
| `--text` | `#e2e4e9` | Haupttext |
| `--text-muted` / `--muted` | `#8b909a` | Meta-Text |
| `--border` | `#2e3138` | Kanten |
| `--accent` / `--accent-hi` | `#8f98a8` / `#a1a8b3` | Aktionen / Fokus |
| `--ok` / `--warn` / `--err` | `#3d9b6a` / `#c9a227` / `#dc7070` | Status |

Akzent und Fehlerfarbe sind so aufgehellt, dass normaler Text auch auf Karten lesbar bleibt. Gold bleibt als Teil des 4AllPass-Logos und als Warn-/Favoritenhinweis erlaubt, ist aber nicht mehr die allgemeine App-Chrome.

Logos bleiben produktspezifisch: 4AllPass-Elster, Gnom-Hub-V1-Marke und TollGate-Marke. Gemeinsame Gestaltung bedeutet keine Zusammenlegung der Apps.

Aktuelles 4AllPass-Logo: Elster mit goldenem Schlüssel auf dem Schriftzug (`frontend/public/logo.png`). App-Icon: Elster allein (`icon-512.png`).

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

Der goldene Schlüssel gehört zur 4AllPass-Marke. Warnungen und aktive Favoriten dürfen Gold nutzen; die allgemeine Desktop-Chrome folgt dem Gnom-Hub-V1-Grau.

## Logo netzwerkpunkt.de (neu)

Portfolio-Logo wird separat entwickelt (siehe Canva / spätere Varianten).  
Konzept-Richtung: zentraler „Punkt“ / Node in einem Netzwerk – klar, modern, KI-/Multi-Agent-tauglich, ohne Verwechslung mit 4AllPass-Elster.

## Nächste Schritte

1. Gnom-Hub-V1-Grau für die 4AllPass-App vollständig prüfen
2. 4AllPass-Logo und Elster unverändert produktspezifisch halten
3. Dieselben Chrome-Grundregeln schrittweise auf weitere NetzwerkPunkt-Apps anwenden
4. Optionaler Light-Mode nur als eigene, geprüfte Designentscheidung
5. Korrekte Schreibweisen auf netzwerkpunkt.de und in den Repositories pflegen

---
*Angelegt als permanente Design-Basis im Repo. Gnom-Namensregel verbindlich.*
