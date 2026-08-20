# 4AllPass – Design Foundation

> Basis-Info, damit nichts verloren geht (Stand 2026-08-20).

## Portfolio / Domain

- **Hauptdomain:** [netzwerkpunkt.de](https://netzwerkpunkt.de)
- Dort sollen alle Projekte, Apps, Webseiten und Portfolio-Items gebündelt werden.
- 4AllPass gehört als weiteres Projekt unter dieses Dach (neben Tollgate, Gnom-Hub etc.).

## Aktuelles UI (Frontend)

Farben aus `frontend/src/styles.css` (nur Dark Theme):

| Token        | Wert      |
|--------------|-----------|
| `--bg`       | `#080c18` |
| `--panel`    | `#101733` |
| `--panel-2`  | `#16204a` |
| `--line`     | `#24306b` |
| `--text`     | `#eaf0ff` |
| `--muted`    | `#93a2d0` |
| `--accent`   | `#7aa2ff` |
| `--ok`       | `#4fd1a5` |
| `--danger`   | `#ff7a90` |

Aktuelles Icon (`frontend/public/icon.svg`): Schild + Schloss, Gradient `#7e14ff` → `#47bfff` auf `#0f172a`.

**Feedback:** Farben und Design der App gefallen noch nicht – Redesign gewünscht.

## Logo-Brief

4AllPass bekommt ein eigenes Logo:

- **Schriftzug:** „4AllPass“
- **Motiv:** eine Elster (Magpie / *Pica pica*), die **auf dem Schriftzug sitzt**
- **Ansicht:** Vorderansicht (frontal)
- **Attribut:** hält einen **goldenen Schlüssel** im Schnabel

Symbolik: Elster = klug, sammelt glänzende Dinge → Passwörter / Keys / Secrets. Goldener Schlüssel = Zugang, Sicherheit, Zero-Knowledge.

Canva-Kandidaten (editierbar im Account) wurden generiert; ein gespeichertes Design:
- [Modern '4AllPass' Logo with Alert Magpie](https://www.canva.com/d/TgTiGOX87wFWhrW)

## Vorgeschlagene Farbpalette – „Golden Magpie“

| Rolle     | Wert      | Begründung                          |
|-----------|-----------|-------------------------------------|
| BG        | `#0A0E1A` | Tiefes, warmes Dunkel               |
| Panel     | `#12182B` | Leicht angehoben                    |
| Accent    | `#C9A227` | Gold – passt zum Schlüssel + Premium |
| Text      | `#F8F4EC` | Warmes Off-White                    |
| Muted     | `#A89F8C` | Neutrales Grau-Beige                |
| OK        | `#3DDC97` | Frisches Emerald für Sicherheit     |
| Danger    | `#FF7A90` | Beibehalten oder leicht anpassen    |

Alternative: Deep Trust Navy mit Gold nur als Highlight für Logo/Key.

## Nächste Schritte

1. Logo-Varianten in Canva finalisieren und als SVG/PNG exportieren
2. `frontend/public/icon.svg` + Branding in der PWA ersetzen
3. Design-Tokens in `styles.css` auf die gewählte Palette umstellen
4. Optional Light-Mode ergänzen
5. 4AllPass auf netzwerkpunkt.de als Portfolio-Projekt eintragen

---
*Angelegt als permanente Design-Basis im Repo.*
