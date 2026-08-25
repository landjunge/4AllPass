# Landing pages deploy

## GitHub Pages (`site/`)

1. Repo Settings → Pages → Source: **GitHub Actions**
2. Merge PR (site/** auf main) → Workflow `Pages`
3. Live: https://landjunge.github.io/4AllPass/

## Subdomain `4allpass.netzwerkpunkt.de` (VPS)

- Datei: `hub-4allpass.html` → als Document-Root `index.html`
- Gleicher Inhalt kann `netzwerkpunkt.de/4allpass` bedienen
- **Canonical:** `https://4allpass.netzwerkpunkt.de/`

## Domain später

Siehe `DOMAIN-STRATEGY.md`.  
Jetzt: keine Domain kaufen. Später: 301 Subdomain → `4allpass.de` (oder `.com`).

## SEO-Checkliste (0 €)

- [x] Title / Description / OG / JSON-LD
- [x] Canonical + alternate Links
- [x] robots.txt + sitemap.xml
- [x] llms.txt
- [x] FAQ (details/summary, kein JS)
- [ ] GitHub Pages aktivieren
- [ ] hub-HTML auf VPS
- [ ] Search Console: Property für Subdomain (kostenlos)
- [ ] Eigenes OG-Bild 1200×630 (optional, Canva Free)
