# Domain-Strategie 4AllPass (kostenlos jetzt → eigene Domain später)

**Stand:** 2026-08-25  
**Budget:** 0 € — keine Domain kaufen, bis Geld da ist.

## Heute (kostenlos)

| Rolle | URL |
|-------|-----|
| **Kanonische Produktseite** | `https://4allpass.netzwerkpunkt.de/` |
| Portfolio-Hub | `https://netzwerkpunkt.de/4allpass` |
| Doku-Spiegel (GitHub Pages) | `https://landjunge.github.io/4AllPass/` |
| Source / Releases | `https://github.com/landjunge/4AllPass` |

Alles verlinkt sich gegenseitig (`sameAs` im Schema + sichtbare Links).  
**Eine Story:** Tresor gehört dem Benutzer → Autofill → ZK → Agenten nur Allow/Deny.

## Später (wenn Budget da)

Kandidaten: `4allpass.de` (bevorzugt, DE) oder `4allpass.com`.

### Migration (Checklist)

1. Domain registrieren + DNS (A/AAAA oder CNAME auf denselben Host wie die Subdomain, oder GitHub Pages Custom Domain)
2. TLS (Let’s Encrypt / Cloudflare Free)
3. **301 Redirect** von `4allpass.netzwerkpunkt.de` → `https://4allpass.de/` (permanent)
4. Canonical + OG + Schema `url` / `sameAs` auf die neue Domain umstellen
5. Sitemap aktualisieren, Search Console Property für die neue Domain
6. GitHub Pages: optional Custom Domain `docs.4allpass.de` oder weiter github.io
7. README + Docs-Links aktualisieren

### Was *nicht* nötig ist

- Domain jetzt „parken“ ohne Inhalt
- Zwei parallele Marken-Stories
- Bezahltes SEO-Tool

### Zwischenzeit

- Subdomain ist vollwertige Produkt-URL (kein „Provisorium“ in der Copy)
- In FAQ/Footer ehrlich: eigene Domain kommt später
- Kein Geld in Ads oder Premium-DNS stecken, bevor Autofill/P0 stabil ist
