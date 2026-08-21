# 4AllPass — Sichtbarkeit (GitHub / Suche)

**Stand der Messung:** 2026-08-21. Keine erfundenen Klick-, Star- oder Traffic-Zahlen.  
**Begleiter:** [`launch-posts.md`](launch-posts.md), [`your-ai-agent-doesnt-need-your-api-keys.md`](your-ai-agent-doesnt-need-your-api-keys.md), [`positioning.md`](positioning.md).  
**Posts nicht automatisch veröffentlichen.** Claims nicht verschärfen.

---

## 1. Diagnose (mit Belegen)

Die Erwartung „4 Monate, 0 Klicks“ passt **nicht** zum öffentlichen GitHub-Artefakt.

| Fakt | Quelle | Wert |
|---|---|---|
| Repo angelegt | `gh repo view` → `createdAt` | **2026-08-17T18:57:17Z** (~4 Tage, nicht 4 Monate) |
| Erster Commit | `git log --reverse` | 2026-08-17 „Initial commit“ |
| Sichtbarkeit | `visibility` | **PUBLIC** (nicht privat) |
| Stars / Forks / Watcher | GitHub API | **0 / 0 / 0** |
| Releases / Tags | `gh release list`, `/tags` | **keine** |
| License-Datei | `LICENSE` 404, Community-Profil | **fehlt** (`licenseInfo: null`, Packages `UNLICENSED`) |
| Website / Homepage | `homepageUrl` | **leer** (soll `https://netzwerkpunkt.de` werden) |
| GitHub Pages | `GET /pages` | **404** (Tollgate und Gnom-Hub haben Pages) |
| Custom Social Preview | `usesCustomOpenGraphImage` | **false** (nur der Default-Octocat-Graph) |
| Discussions | GraphQL | **aus**, 0 Threads |
| npm/GitHub Packages | `/users/landjunge/packages` | **leer** |
| Traffic Insights | `/traffic/views|clones|referrers` | **403** für dieses Token — Owner muss Insights selbst lesen |
| Community health | `/community/profile` | **71 %** (README + CONTRIBUTING + SECURITY ja; License + CoC nein) |

### Suite-Hauptseite `netzwerkpunkt.de`

`docs/DESIGN.md` nennt die Domain schon als Dach. Öffentliche Suche indexiert sie als **KI-Portfolio von landjunge**: Tollgate und Gnom-Hub-V1 als „in Arbeit“. **4AllPass war in diesem Index noch nicht.** Kein Shop. DNS: netcup (`185.243.11.43`). HTTPS von diesem Token: `SSL_ERROR_SYSCALL` (HTTP `403`) — kein Zeilen-Claim auf Live-HTML.

Informationsarchitektur:

| Fläche | Rolle |
|---|---|
| `https://netzwerkpunkt.de` | Hauptseite. About-Website. Klickziel **nach** 4AllPass-Abschnitt. |
| `site/` (github.io Fallback) | Produktfront DE/EN + Karten in `site/produkte/`. |
| GitHub | Quelle. |

Karten und Status: [`../site/produkte.json`](../site/produkte.json). 4AllPass-Karte: Quelle GitHub, Hub-Eintrag noch ausstehend.

Was schon da war (nicht das Problem):

- Description im About-Kasten ist gesetzt.
- 8 Topics sind gesetzt: `ai-agents`, `credentials`, `n8n`, `password-manager`, `pwa`, `self-hosted`, `webauthn`, `zero-knowledge`.
- Profil-README von landjunge verlinkt 4AllPass als Credentials-Schicht.
- Launch-Texte liegen im Repo, sind aber **nicht gepostet**.

### Warum Google / „die Suche“ 4AllPass nicht findet

Websuche nach `"4AllPass"` / `4allpass` / `landjunge` + vault am 2026-08-21:

- Treffer 1: **All Pass Hub** (`allpasshub.com`) — kommerzieller Team-Passwortmanager, Zero-Knowledge-Marketing, Indexed.
- Treffer 2: **Allpass** (Flutter, `sunyongsheng/Allpass`) — älterer OSS-Name, eigene Domain.
- Weitere: `hph/AllPass`, `1pass4all`.
- **`github.com/landjunge/4AllPass` erschien in diesen Suchen nicht.**

GitHub-Suche nach `4AllPass` findet das Repo. Google indexiert neue GitHub-Repos langsam, **wenn niemand von außen darauf zeigt**. Ohne Website, ohne Release-Seite, ohne Backlinks, ohne Launch-Post gibt es nichts zu crawlen außer einem 4 Tage alten Repo, dessen Name schon von anderen Produkten belegt ist.

### Warum 0 Klicks hier normal ist — und was „4 Monate“ bedeuten kann

1. **Die öffentliche Uhr läuft seit dem 17.08.2026.** Alles davor war lokal oder privat. GitHub-Traffic kann es für diesen Clone nicht gegeben haben.
2. **Kein Launch.** [`launch-posts.md`](launch-posts.md) sagt ausdrücklich: nicht automatisch gepostet.
3. **Kein Release.** AliasVault, Vaultwarden, Passbolt, Infisical haben versionierte Releases — das erzeugt indexierbare URLs und „Latest“-Badges.
4. **Keine License.** awesome-selfhosted verlangt FOSS-Lizenz **und** „first released more than 4 months ago“. Ohne License-PR und ohne Release-Datum startet diese Uhr nicht.
5. **Namenskollision.** Suchende landen bei All Pass Hub / Allpass, nicht hier.
6. **README war ehrlich, aber nicht scannbar.** Die ersten Zeilen begruben „was ist das / für wen / wie try ich es“ hinter Caveats.
7. **Homepage leer, kein `github.io`.** Tollgate und Gnom-Hub haben genau diese Fläche; 4AllPass nicht.
8. **0 Stars.** GitHub-Suche gewichtet Popularität. Chicken-Egg: ohne Launch keine Stars, ohne Stars kein Ranking unter `topic:password-manager`.

Das ist kein Crypto-Bug und kein „GitHub hasst uns“. Es ist ein **nicht gestartetes öffentliches Artefakt** plus ein **belegter Name**.

---

## 2. Vergleich — was erfolgreiche Vault-/Secret-Repos anders machen

Gemessen 2026-08-21 (`gh repo view`):

| Repo | Stars | License | Homepage | Releases | Discussions | Topics (Auszug) | README-Muster |
|---|---|---|---|---|---|---|---|
| [dani-garcia/vaultwarden](https://github.com/dani-garcia/vaultwarden) | 65721 | AGPL-3.0 | — | ja (`1.37.1`) | ja | `vaultwarden`, `bitwarden`, `docker` | Eine Zeile: was es *ist* (Bitwarden-kompatibler Server). Install = Container. |
| [Infisical/infisical](https://github.com/Infisical/infisical) | 28866 | Other | infisical.com | ja, häufig | ja | 20 Topics inkl. `secret-management`, `vault` | H1 + eine Zeile + Website/Docs/Cloud-Links + echte Badges. Custom OG. |
| [passbolt/passbolt_api](https://github.com/passbolt/passbolt_api) | 6081 | AGPL-3.0 | passbolt.com | ja | nein | `password-manager`, `credentials` | Produktname + „for teams“ + Website. |
| [lesspass/lesspass](https://github.com/lesspass/lesspass) | 6050 | GPL-3.0 | lesspass.com | — | nein | `password-manager`, `self-hosted` | Eine Zeile + Domain im Namen. |
| [aliasvault/aliasvault](https://github.com/aliasvault/aliasvault) | 3044 | AGPL-3.0 | aliasvault.com | ja (`0.30.4`) | ja | `password-manager`, `argon2id`, `docker`, `browser-extension` | Release-Badge, Demo/Website/Docs, Screenshots, Self-host-Anker. |

Gemeinsam, und bei uns bis zu diesem PR fehlend:

1. **Eine Website-URL im About-Kasten** — Suite-Hauptseite `https://netzwerkpunkt.de`, nicht nur github.io.
2. **SPDX-License im Repo-Root** — sonst kein awesome-selfhosted, kein License-Filter.
3. **Release-Tags** — auch `v0.1.0` zählt; die 4-Monats-Uhr für Listen startet hier.
4. **README-Erste-15-Zeilen:** Was / für wen / Try / Screenshot. Caveats darunter.
5. **Externe Posts** (Show HN, r/selfhosted, eigene Domain). GitHub allein verteilt nicht.

Infisical ist der nächste *Wedge-Vergleich* (Secrets für Apps/Agenten), nicht Vaultwarden. Vaultwarden gewann, weil es ein bekanntes Client-Ökosystem günstig self-hostbar machte. 4AllPass muss den **Agent-Access**-Keil erzählen, nicht „noch ein ZK-Vault“.

---

## 3. GitHub-Einstellungen — exakte Werte (Owner)

`gh` in dieser Umgebung ist **read-only** (`403 Resource not accessible by integration`). Topics, Description, Website, Social Preview, Pages und Releases kann nur der Owner setzen.

### 3.1 About-Kasten

GitHub → `landjunge/4AllPass` → Zahnrad neben **About**.

| Feld | Wert |
|---|---|
| **Description** (≤350) | `Self-hosted zero-knowledge password manager with WebAuthn unlock and local agent credential access. Your agents need access — they don't need your secrets. Not All Pass Hub.` |
| **Website** | `https://netzwerkpunkt.de` (Suite-Hauptseite. github.io/4AllPass bleibt Fallback-Landing, nicht der About-Wert.) |
| **Releases** | angehakt |
| **Packages** | aus, bis etwas publiziert ist |

Oder:

```sh
gh repo edit landjunge/4AllPass \
  --description "Self-hosted zero-knowledge password manager with WebAuthn unlock and local agent credential access. Your agents need access — they don't need your secrets. Not All Pass Hub." \
  --homepage "https://netzwerkpunkt.de"
```

### 3.2 Topics (max. 20) — ersetze die bestehenden 8

```sh
gh repo edit landjunge/4AllPass --add-topic password-manager
gh repo edit landjunge/4AllPass --add-topic zero-knowledge
gh repo edit landjunge/4AllPass --add-topic webauthn
gh repo edit landjunge/4AllPass --add-topic self-hosted
gh repo edit landjunge/4AllPass --add-topic pwa
gh repo edit landjunge/4AllPass --add-topic ai-agents
gh repo edit landjunge/4AllPass --add-topic n8n
gh repo edit landjunge/4AllPass --add-topic credentials
gh repo edit landjunge/4AllPass --add-topic argon2id
gh repo edit landjunge/4AllPass --add-topic passkey
gh repo edit landjunge/4AllPass --add-topic vault
gh repo edit landjunge/4AllPass --add-topic secret-management
gh repo edit landjunge/4AllPass --add-topic fastapi
gh repo edit landjunge/4AllPass --add-topic typescript
gh repo edit landjunge/4AllPass --add-topic browser-extension
gh repo edit landjunge/4AllPass --add-topic docker
gh repo edit landjunge/4AllPass --add-topic end-to-end-encryption
gh repo edit landjunge/4AllPass --add-topic agent-credentials
gh repo edit landjunge/4AllPass --add-topic passwordless
gh repo edit landjunge/4AllPass --add-topic security
```

UI: About → Topics → dieselben 20 Strings. Nicht `hacktoberfest` erfinden, nicht `bitwarden` (wir sind kein kompatibler Server).

### 3.3 Social Preview

Datei im Repo: [`docs/assets/social-preview.png`](assets/social-preview.png) (1280×640).

1. Settings → General → **Social preview**
2. Edit → Upload `docs/assets/social-preview.png`
3. Prüfen: Link auf Slack/X zeigt Elster+Key, nicht den Default-Graph.

### 3.4 GitHub Pages

1. Settings → Pages → **Source: GitHub Actions**
2. Workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) ist im Repo (skipped, solange Pages aus ist — gleiches Muster wie Tollgate).
3. Nach dem ersten grünen `Pages`-Run: github.io bleibt **Fallback**. About-Website bleibt `https://netzwerkpunkt.de`.
4. Optional: IndexNow / Search Console auf der Hauptdomain, nicht am Tag 1.
5. Custom-Domain / TLS / CNAME-Reste gehören auf **netzwerkpunkt.de** (netcup), nicht auf den github.io-Fallback.
6. **4AllPass-Abschnitt auf dem Hub anlegen, bevor** Launch-Posts `netzwerkpunkt.de` als Klickziel nutzen. Bis dahin: Repo oder `site/`-Fallback.

### 3.5 Discussions + Wiki

- Settings → Features → **Discussions** an (Q&A + Ideas). Issue-Templates bleiben für Bugs/Security.
- Wiki kann **aus**. Es ist leer und verdünnt die Specs in `docs/`.

### 3.6 Profil

- `landjunge/landjunge` verlinkt 4AllPass bereits. **Pin** das Repo auf dem Profil (UI: Profil → Customize pins).
- Pin-Beschreibung darf `netzwerkpunkt.de` nennen. github.io ist nur Fallback.

### 3.7 License (Owner-Entscheidung, nicht in diesem PR)

Ohne Root-`LICENSE` bleibt Community health bei ~71 %, GitHub zeigt kein SPDX, awesome-selfhosted lehnt ab.

Vergleichbare Vaults: **AGPL-3.0** (Vaultwarden, Passbolt, Padloc, AliasVault) oder **MIT** (AliasVault-Datenfile; Infisical „Other“).

Dieser PR setzt **keine** License. Packages bleiben `UNLICENSED`, bis du eine wählst. Empfohlene Reihenfolge:

1. AGPL-3.0 wählen, wenn Self-Host-Änderungen zurückfließen sollen.
2. Datei `LICENSE` (GitHub „Add file → Create new file → Choose a license template“).
3. `license`-Feld in den `package.json` der Packages von `UNLICENSED` auf das SPDX ändern — **gleicher PR**.

---

## 4. Erstes Release (startet die 4-Monats-Uhr)

awesome-selfhosted: FOSS-Lizenz **und** „first released more than 4 months ago“. Ohne Tag gibt es kein Releasedatum.

Vorschlag, sobald License steht (oder als Pre-Release ohne Listeneintrag):

```sh
git tag -a v0.1.0 -m "v0.1.0 — self-hosted ZK vault + local Access tab"
git push origin v0.1.0
gh release create v0.1.0 --title "v0.1.0" --notes-file - <<'EOF'
Self-hosted zero-knowledge vault (Argon2id, WebAuthn unlock, PWA) plus a local Access tab.

Honest limits: FastAPI never mints tokens. No n8n marketplace node. Server stores envelopes only.

Try: docs/two-minute-demo.md
EOF
```

Release-Notes nicht aufblasen. Ein Try-Link, drei Limits, Compose-Befehl.

---

## 5. 30-Tage-Plan

Voraussetzung: About, Topics, Pages, Social Preview, Pin. License + `v0.1.0` so früh wie die rechtliche Entscheidung da ist.

| Tag | Aktion | Kanal | Regel |
|---|---|---|---|
| 0 | Dieser PR mergen. Owner-Schritte §3. | GitHub | Keine Fake-Stars. |
| 1 | 4AllPass auf [netzwerkpunkt.de](https://netzwerkpunkt.de) eintragen (steht im indexierten Portfolio noch nicht; Tollgate und Gnom-Hub-V1 ja, als „in Arbeit“). | Hub | Kein fertiger Katalog behaupten. |
| 1 | Pages-Fallback prüfen: `https://landjunge.github.io/4AllPass/` lädt. | Browser | About-Website bleibt netzwerkpunkt.de. |
| 1 | X-Thread aus [`launch-posts.md`](launch-posts.md) §1 + §5. | X | Nicht auto-posten. Klickziel = netzwerkpunkt.de sobald die Produktseite existiert, sonst Repo. |
| 2 | n8n-Community-Post aus `launch-posts.md` §2. | n8n community | Titel ehrlich: kein Node. Walkthrough-Link. |
| 3 | MCP/Agent-Post §3 **oder** DevOps §4 — nicht alle vier an einem Tag. | X / passendes Forum | Ein Keil pro Thread. |
| 4–7 | **Show HN** (nicht am Wochenende; Di–Do 8–11 ET). | news.ycombinator.com | Titel: `Show HN: 4AllPass – local allow/deny for agent credentials on a ZK vault`. Link = netzwerkpunkt.de-Produktseite wenn sie existiert, sonst Repo. Erster Kommentar: warum, local broker, Limits. 2–3 h im Thread. Kein Vote-Ring. |
| 7–10 | r/selfhosted **ein** Textpost (Rules lesen: meist Self-Promo-Faden / 10 %-Regel). | Reddit | Titel ohne Superlative. Compose + Demo. Nicht r/netsec mit Marketing. |
| 10–14 | Week-8-Artikel nach Dev.to / eigenem Blog **unverändert** (keine stärkeren Claims). | Dev.to | Footer: netzwerkpunkt.de + Repo. |
| 14–20 | Discussions: ein „Show the Access tab“-Thread als Anlaufpunkt. | GitHub | Keine Fake-Issues. |
| 20–30 | Zweiter kleiner Release nur wenn sich das Claim-Surface ändert. | GitHub | Leere Releases sind Lärm. |
| **Nicht vor ~4 Monaten nach `v0.1.0` + License** | PR auf [awesome-selfhosted-data](https://github.com/awesome-selfhosted/awesome-selfhosted-data) | YAML-Addition | Tag `Password Managers`. Description &lt; 250 Zeichen, sentence case. Siehe deren `addition.md`. |

Show-HN-Kommentar (Rohling, Claims nicht erhöhen):

```text
I built this because I kept pasting GitHub / OpenAI keys into n8n.

The vault is device-centric ZK (Argon2id, WebAuthn PRF, envelopes). The new piece is a local Access tab: n8n asks for GitHub repository.read → Allow → TTL. repository.delete is DENY. The FastAPI process never sees the token.

Honest limits: no n8n marketplace node, application identity is a string today, expiry does not un-know a copy already given.

Repo: https://github.com/landjunge/4AllPass
Demo: https://github.com/landjunge/4AllPass/blob/main/docs/two-minute-demo.md
```

---

## 6. Wie Git selbst Sichtbarkeit erzeugt

| Hebel | Warum | Was wir tun |
|---|---|---|
| **Tags + Releases** | Eigene, indexierbare URLs; „Latest“ im About; Show-HN-Material | Erstes `v0.1.0`, dann nur bei echten Schnitten |
| **Commit-Messages** | Öffentliche History ist das Audit-Argument | `feat\|fix\|harden\|docs\|test\|ci` + Fläche, wie bisher |
| **Aktive main** | Freshness-Signal für GitHub-Suche und Google | Nicht leere „chore“-Streaks; echte Spec/Code-Paare |
| **CONTRIBUTING + Templates** | Contributor-Signal, Community-Health | Schon da. Discussions für Fragen. |
| **CI-Badge** | Einziger Badge, der *jetzt* wahr ist | README (dieser PR). Kein Star-Count-Badge. |
| **Dependency graph / Packages** | Entdeckung über „used by“, npm search | Erst wenn `@4allpass/crypto` **absichtlich** public + licensed ist. Heute `private: true`. |
| **GitHub-Suche / Topics** | Topics sind Filter, nicht Magie | 20 Topics setzen (§3.2) |
| **Profil-Pin + Website** | Ein Mensch, vier Produkte — Credentials muss anfassbar sein | Pin + github.io |
| **llms.txt** | Agenten und manche Crawler lesen es | Root + `site/llms.txt` |

Git ersetzt keinen Launch. Es macht den Launch **überprüfbar**: Specs, KATs, Security Boundary, reproduzierbare Hashes. Das ist der Vorteil gegenüber All Pass Hub.

---

## 7. Metriken (Owner, 14 Tage nach Launch)

GitHub → Insights → Traffic (nur Owner/Admin):

| Metrik | Wozu | Erste sinnvolle Schwelle |
|---|---|---|
| Unique visitors / views | Ob Posts ankommen | >0 in der Woche nach Show HN / X |
| Unique cloners | Ob jemand *try* meint | Clones ≫ Stars am Anfang ist ok |
| Referring sites | Welcher Post wirkte | netzwerkpunkt.de, news.ycombinator.com, t.co, reddit.com |
| Popular content | README vs. Demo vs. Article | Demo sollte klettern |
| Stars / Forks / Watchers | Nachlauf, nicht Ziel | Nicht täglich anstarren |
| Search: `site:netzwerkpunkt.de 4AllPass` | Hub-Index | Erst nachdem die Produktkarte live ist |
| Search: `4AllPass landjunge` | Namenskollision | Muss uns zeigen, nicht nur All Pass Hub |

Traffic-API (`/repos/…/traffic/views`) braucht `repo` Admin. Dieses Agent-Token bekam 403.

---

## 8. Was nicht funktioniert

- Topics setzen und warten.
- Star-Betteln, Fake-Activity, Vote-Ringe.
- awesome-selfhosted **jetzt** (keine License, Release &lt; 4 Monate).
- Keyword-Stuffing oder „military-grade“ / Audit-Claims.
- n8n-Marketplace oder FastAPI-Token-Mint behaupten.
- Den Namen „4AllPass“ gegen All Pass Hub **ohne** `landjunge` / `netzwerkpunkt.de` / „not All Pass Hub“ zu führen.
- Eine fünfte parallele Feature-Branch statt Launch.
- Tollgate und 4AllPass in einem Pitch vermischen.
- Launch-Posts auf `netzwerkpunkt.de` zeigen, **bevor** dort ein 4AllPass-Abschnitt steht.

---

## 9. In-Repo (dieser PR)

Erledigt, soweit Git das kann:

- README: scannbare erste Fläche, Suite-Tabelle (Hub / `site/` / Quelle).
- `package.json` homepage → `https://netzwerkpunkt.de`.
- `site/`: Produktfront DE/EN, Karten aus `produkte.json`, Desk-Chrome.
- `llms.txt` + dieses Dokument.

Nicht erledigt (Owner):

1. `gh repo edit landjunge/4AllPass --homepage "https://netzwerkpunkt.de"`
2. 4AllPass auf netzwerkpunkt.de eintragen (Karten: `site/produkte/` zum Kopieren)
3. Pages-Source GitHub Actions, Social Preview, Topics
4. Launch-Posts erst dann auf den Hub zeigen
5. License + `v0.1.0`
