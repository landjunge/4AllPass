# 4AllPass

<p align="center"><img src="frontend/public/logo.png" alt="4AllPass" width="420" /></p>

**DE:** Lokaler Passwort-Tresor. Browser-Passwörter übernehmen, Autofill, Zero-Knowledge.  
**EN:** Local-first password vault. Import from browsers, autofill, zero-knowledge.

```text
Installieren → Importieren → Autofill → fertig
Zugriff (Allow/Deny) ist Advanced — nicht der Einstieg
```

---

## Für normale Menschen / For normal people

4AllPass ist ein digitaler Tresor, der **wirklich dir gehört**. / A digital vault that **truly belongs to you**.

Bei den meisten Passwort-Apps speichert eine Firma deine Daten in der Cloud. Bei 4AllPass kann die Firma (oder der Server) deine Passwörter **nicht lesen**.  
With most password apps a company stores your data in the cloud. Here the company (or the server) **cannot read** your passwords.

**Das Produkt ist die Desktop-App.** Installieren, Tresor anlegen, Passwörter aus dem Browser holen — danach erledigt 4AllPass den Login.  
**The product is the desktop app.** Install, create a vault, import from the browser — then 4AllPass handles the login.

Agenten (n8n, KI-Tools) nur nach **Erlauben oder Ablehnen**, nie den ganzen Tresor. / Agents only after **Allow or Deny**, never the whole vault.

**Was du davon hast / What you get**
- Autofill ohne Copy-Paste
- Schlüssel auf diesem Gerät
- Kein verpflichtender Cloud-Dienst (Local-first. Sync optional. Server deiner Wahl.)
- Notfall-Kit — ohne das gibt es kein Zurück, und das ist Absicht
- Agent-Zugang nur unter deiner Kontrolle, nicht als ersten Bildschirm

Wir bauen **nicht** Blockchain, eigene digitale Identität oder 20 Zukunftsfeatures auf einmal. Zuerst Alltag. Vision: **Daniel Filipek (landjunge)**.

---

## How this is built / Wie dieses Projekt entsteht

**System Designer & Product Architect** — Daniel Filipek (landjunge)

Ich entwickle Systeme mit KI als technischem Partner. Produktvision und Grenzen kommen von mir. Code, Specs und Tests müssen überprüfbar sein. Ich behaupte **nicht**, dass die Kryptographie sicher ist — Annahmen stehen in den Specs. **Noch kein unabhängiges Drittaudit.** Reviews sind willkommen.

Kein verpflichtender Cloud-Dienst. Der Server sieht keinen Klartext. FastAPI mintet **keine** Tokens. Docs: [`docs/README.md`](docs/README.md). Haltung: [`docs/product-philosophy.md`](docs/product-philosophy.md).

---

## Install

Ein Befehl. Kein Node, kein Python, kein Docker. / One command. No Node, Python, or Docker.

```sh
curl -fsSL https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.sh | sh
```

Windows: `irm https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.ps1 | iex`

Seite: [4allpass.netzwerkpunkt.de](https://4allpass.netzwerkpunkt.de/) · [Releases · desktop](https://github.com/landjunge/4AllPass/releases/tag/desktop)

Ohne Pipe: Script speichern, lesen, `sh install.sh`. Tag **`desktop`**, SHA-256. Vault-Ordner wird **nicht** gelöscht. Noch nicht notariert: Rechtsklick → Öffnen. SHA-256 schützt vor kaputtem Download, **nicht** vor einem kompromittierten GitHub-Account. Alpha.

1. Tresor anlegen, Recovery-Kit bestätigen.
2. Browser: Import-Review **ohne** Passwort in der Liste → Bestätigen.
3. Autofill auf der Seite.

---

## Heute / Today (ehrlich)

| | |
|---|---|
| Produkt | Desktop-App. Unlock = Tresor-Passwort |
| Ablage | Local-first. Sync optional. Server deiner Wahl. Hosted **nicht** angeboten |
| Import | Chrome/Firefox. Review ohne Passwort in der Liste |
| Autofill | Chromium, Firefox, Safari-Wrapper. Live `github.com/login` opt-in, kein Submit |
| Zugriff | Allow/Deny auf diesem Rechner. `n8n` ist ein **Name**, kein Ausweis. TTL holt eine Kopie nicht zurück |
| Recovery | Emergency Kit. Kein Server-Reset |
| WebAuthn PRF | Im Protokoll; in der Desktop-Webview **unbewiesen** |
| Apple | Notarisierung pausiert (~99 USD/Jahr) |
| Audit | Kein unabhängiges Drittaudit |

Was die Software **wirklich** erzwingt: [`docs/security-boundary.md`](docs/security-boundary.md).

---

## Development

Nur für den Source-Build. Die Desktop-App braucht das nicht.

```sh
git clone https://github.com/landjunge/4AllPass.git
cd 4AllPass && npm install
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt && cd ..
npm run build:extension
npm run tauri:dev
```

Tests: `npm test` · `npm run typecheck` · `cd backend && pytest`. Mitmachen: [`CONTRIBUTING.md`](CONTRIBUTING.md). Sicherheit: [`SECURITY.md`](SECURITY.md).

Der Vault Key ist zufällig, nie aus dem Passwort abgeleitet. Specs: [`docs/README.md`](docs/README.md).
