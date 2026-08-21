# GitHub sichtbar nutzen — DE / EN

**4AllPass only.** Standing: every public surface **Deutsch und Englisch**, SEO in the same PR.

---

## Deutsch — was GitHub wirklich indexiert

| Hebel | Wirkung | Hier |
|---|---|---|
| Repo-**Name** | Exact-Match in GitHub-Suche | `4AllPass` |
| **About**-Beschreibung | Meta-Description für Google + GitHub | Sidebar, API |
| **Topics** (max. 20) | Filter auf github.com/topics/… | `ai-agents`, `credentials`, `zero-knowledge`, `n8n`, `webauthn`, `self-hosted`, `pwa` |
| **README** (H1, erste 20 Zeilen, Bild) | Landing + Open-Graph-Bild | diese Datei / `README.md` |
| **Social preview** | Karte bei Link-Shares | Settings → General → Social preview — Datei `frontend/public/og.png` (1280×640, Logo inkl. Schriftzug). GitHub hat **keine** öffentliche Upload-API; PAT reicht nicht. |
| **Releases** | Version, Changelog, GitHub-Suche | nach echten Meilensteinen, nicht leer |
| **Discussions** | Google indexiert oft die Discussions-Startseite | Settings → Features |
| **Issues** mit klaren Titeln | Suche + Contributor-Einstieg | keine Secrets in Issues |
| **Public** + Aktivität | Crawler sehen nur public | private Beiträge zählen nicht |
| **Backlinks** | Google findet das Repo über andere Sites | netzwerkpunkt.de, Artikel, n8n-Community — erst nach der Demo |
| **GitHub Pages** | eigene URL unter `*.github.io` | optional, nicht Pflicht |
| **Profil-README** `landjunge/landjunge` | Google + GitHub-Profil | Dachstory, 4AllPass = Credentials |

Was GitHub **nicht** ist: ein App Store. Stars allein sind schwach. Signale: Installation, Issues, PRs, „I have this problem.“

Nicht: Star kaufen, zehn Communities denselben Spam, „please star“.

---

## English — what actually ranks

GitHub search and Google both read **name, description, topics, README headings, and public activity**. Stars correlate with popularity but are not the goal. Fill About + topics, keep the README’s first screen as the pitch (logo + one-line wedge + how to try), ship Releases when there is a real milestone, turn on Discussions if you want indexed Q&A. External links (site, article, n8n thread) are how Google discovers the repo.

Profile README and repo README must agree: 4AllPass is credential access, not “a nicer Bitwarden.”

---

## Checklist (every public change)

- [ ] README: DE **und** EN, Logo inkl. Schriftzug oben
- [ ] `index.html`: title, description, og:title, og:description, og:image (`/og.png`), locale de + en
- [ ] GitHub About description + topics updated if the pitch changed
- [ ] No secrets in README, issues, or release notes
