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

Quelle: `frontend/src/networkpunkt.css` (gemeinsame Basis),
`frontend/src/tokens.css` (Produktadapter), `brand/README.md` (AP4).

| Rolle | Gemeinsamer Wert |
|---|---|
| Canvas / Fläche | `#121316` / `#1a1c20` |
| Text / Meta | `#edf0f4` / `#afb6c1` |
| Grün / Gelb / Rot | `#7bdaa7` / `#e4be70` / `#f49b9b` plus Text/Symbol |
| Schriftrollen | 12 / 14 / 16 / 24px |
| Kontrolle / Touch | 40 / 44px, sichtbarer Tastaturfokus |

Das aktuelle Logo ist das ausdrücklich freigegebene AP4-Rastermotiv. Originale,
Hell/Dunkel, Größen und Native-Ableitungen sind in `brand/README.md` belegt.
Die bestehende 4AllPass-Anordnung unter 820px und Touch-Regeln bleiben erhalten;
keine allgemeine 1180px-Mindestbreite und kein pauschales Verstecken der Scrollbar.
Produkte behalten eigene Identität und technische Eigenständigkeit.

## Historischer Logo-Brief 4AllPass (ersetzt, nicht mehr umsetzen)

4AllPass bekommt ein eigenes Logo:

- **Schriftzug:** „4AllPass“
- **Motiv:** eine Elster (Magpie / *Pica pica*), die **auf dem Schriftzug sitzt**
- **Ansicht:** Vorderansicht (frontal)
- **Attribut:** hält einen **goldenen Schlüssel** im Schnabel

Symbolik: Elster = klug, sammelt glänzende Dinge → Passwörter / Keys / Secrets. Goldener Schlüssel = Zugang, Sicherheit, Zero-Knowledge.

Canva-Kandidaten (editierbar im Account):
- [Modern '4AllPass' Logo with Alert Magpie](https://www.canva.com/d/TgTiGOX87wFWhrW)

## Historische Logo-Farbe vs. Chrome (ersetzt durch AP4)

Der goldene Schlüssel gehört zur 4AllPass-Marke. Warnungen und aktive Favoriten dürfen Gold nutzen; die allgemeine Desktop-Chrome folgt dem Gnom-Hub-V1-Grau.

## Logo netzwerkpunkt.de (neu)

Portfolio-Logo wird separat entwickelt (siehe Canva / spätere Varianten).  
Konzept-Richtung: zentraler „Punkt“ / Node in einem Netzwerk – klar, modern, KI-/Multi-Agent-tauglich, ohne Verwechslung mit dem aktuellen AP4-Produktmotiv.

## Nächste Schritte

1. Gnom-Hub-V1-Grau für die 4AllPass-App vollständig prüfen
2. Freigegebenes AP4-Logo unverändert produktspezifisch halten
3. Dieselben Chrome-Grundregeln schrittweise auf weitere NetzwerkPunkt-Apps anwenden
4. Optionaler Light-Mode nur als eigene, geprüfte Designentscheidung
5. Korrekte Schreibweisen auf netzwerkpunkt.de und in den Repositories pflegen

---
*Angelegt als permanente Design-Basis im Repo. Gnom-Namensregel verbindlich.*
