# Landing pages deploy

## GitHub Pages (`site/`)

1. Repo Settings → Pages → Source: **GitHub Actions**
2. Merge PR (site/** auf main) → Workflow `Pages`
3. Live: https://landjunge.github.io/4AllPass/

## Subdomain `4allpass.netzwerkpunkt.de` (VPS)

- Datei: `hub-4allpass.html` → `/srv/netzwerkpunkt/4allpass/landing/index.html`
- nginx: `deploy/nginx-landing.conf` — **kein** `/api`
- Gleicher Inhalt kann `netzwerkpunkt.de/4allpass` bedienen
- **Canonical:** `https://4allpass.netzwerkpunkt.de/`
- Vault is a **different** origin: `vault.4allpass.netzwerkpunkt.de` — [`../deploy/LAYOUT.md`](../deploy/LAYOUT.md)

## Domain später

Siehe `DOMAIN-STRATEGY.md`.  
Jetzt: keine Domain kaufen. Später: 301 Subdomain → `4allpass.de` (oder `.com`).

## SEO-Checkliste (0 €)

- [x] Title / Description / OG / JSON-LD
- [x] Canonical + alternate Links
- [x] robots.txt + sitemap.xml
- [x] llms.txt
- [x] FAQ (details/summary, kein JS)
- [x] GitHub Pages aktivieren (Actions, 2026-08-26)
- [x] hub-HTML auf VPS (`https://4allpass.netzwerkpunkt.de/`, HTTPS Let’s Encrypt)
- [ ] Search Console: Property für Subdomain (kostenlos)
- [ ] Eigenes OG-Bild 1200×630 (optional, Canva Free)
