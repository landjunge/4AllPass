# Domain-Strategie — Netzwerkpunkt zuerst

**Stand:** 2026-08-25  
**Entscheidung:** `netzwerkpunkt.de` ist die **Hauptdomain**. Dort werden Repos/Produkte ab einer bestimmten Reife **vorgestellt**. Einzel-Domains (`4allpass.de` o.ä.) sind optional und nicht nötig.

## Architektur

```text
netzwerkpunkt.de              ← Marke, Portfolio, Hub
  ├── /                       ← Übersicht aller Werkzeuge
  ├── /4allpass               ← Produkt-Eintrag im Hub
  ├── /tollgate
  ├── /gnom-hub-v1
  └── …

4allpass.netzwerkpunkt.de          ← Produkt-Landing (static, no /api)
vault.4allpass.netzwerkpunkt.de    ← Vault endpoint (ciphertext only)
tollgate.netzwerkpunkt.de          ← analog; own tree under /srv/netzwerkpunkt/tollgate
…

github.com/landjunge/…        ← Source
*.github.io/…                 ← Doku-Spiegel (optional)
```

**Regel:** Ein Produkt erscheint auf dem Hub, wenn es vorzeigbar ist (Install, klare Story, kein reines Experiment). Davor reicht Repo + interne Docs.

## URLs für 4AllPass (heute)

| Rolle | URL |
|-------|-----|
| **Marke / Portfolio** | `https://netzwerkpunkt.de/` |
| **Hub-Eintrag** | `https://netzwerkpunkt.de/4allpass` |
| **Produkt-Landing** | `https://4allpass.netzwerkpunkt.de/` |
| **Vault endpoint** | `https://vault.4allpass.netzwerkpunkt.de/` — not the landing origin |
| Doku-Spiegel | `https://landjunge.github.io/4AllPass/` |
| Source / Releases | `https://github.com/landjunge/4AllPass` |

### Canonical-Empfehlung

- **Produkt-Landing (Subdomain):** canonical = sich selbst  
  `https://4allpass.netzwerkpunkt.de/`
- **Hub-Pfad `/4allpass`:** gleiche Story, canonical **auf die Subdomain**  
  (oder 301 → Subdomain — eine Variante wählen, nicht beide ranken lassen)
- **GitHub Pages:** eigenes canonical + `alternate` / Links zur Subdomain und zum Hub

Schema `sameAs`: GitHub, Hub, Subdomain, Pages.

## SEO unter der Hauptdomain

1. **Autorität sammelt `netzwerkpunkt.de`** — starke interne Verlinkung Hub → Produkt-Subdomain.
2. Subdomains sind eigene „Sites“ für Google; sie brauchen **eigene** guten Inhalt + Sitemap, profitieren aber von sichtbaren Links vom Hub.
3. Eine Produkt-Story überall (Mensch zuerst bei 4AllPass) — kein Agent-first auf der Subdomain und Tresor-Story auf Pages.
4. Search Console: Property für `netzwerkpunkt.de` **und** optional URL-Präfix-Property für die Produkt-Subdomain.

## Eigene Produkt-Domain (optional, später)

`4allpass.de` / `.com` ist **kein Muss**. Sinnvoll nur wenn:

- Budget da ist **und**
- das Produkt stabil vorzeigbar ist **und**
- ein eigener Domain-Name klaren Nutzen hat (Presse, Partner, Merch)

Dann: 301 von `4allpass.netzwerkpunkt.de` → `4allpass.de`, Canonical umstellen.  
Der Hub-Eintrag unter `netzwerkpunkt.de/4allpass` bleibt (Marke bleibt Netzwerkpunkt).

## Budget 0 €

- Keine Domain kaufen
- Kein Premium-DNS / keine Ads für Rankings
- Fokus: Inhalt + Hub-Links + HTTPS + eine Canonical-Linie

## Checkliste Produkt „reif für den Hub“

- [ ] Install / Download erklärbar
- [ ] Eine klare Nutzen-Story (Landing)
- [ ] Security-Grenzen ehrlich (kein Overclaim)
- [ ] Link vom Hub + Subdomain live
- [ ] GitHub README zeigt auf Hub + Subdomain
