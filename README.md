# 4AllPass

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/design/icons/dark/4AllPass-dark-128.png">
  <img src="assets/design/icons/light/4AllPass-light-128.png" alt="4AllPass" width="96" height="96">
</picture>


<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="brand/ap4/light/4allpass-light-256.png">
    <img src="brand/ap4/dark/4allpass-dark-256.png" alt="4AllPass — AP4" width="192" height="192">
  </picture>
</p>

<p align="center"><strong>Ein digitaler Tresor, der wirklich dir gehört.</strong></p>

Lokaler Passwort-Manager. Autofill. Zero-Knowledge. KI-Zugriff ohne geschützten Nutzungsweg gesperrt.

Local-first password manager. Autofill. Zero-knowledge. AI access is blocked without a protected execution path.

4AllPass speichert Passwörter und Zugänge auf deinem Gerät. Ein Anbieter oder Server soll sie nicht lesen können. Das gilt für die **App auf dem Gerät**. Eine vom Storage-Server gelieferte PWA kann der Betreiber tauschen — das ist kein Zero-Knowledge gegen ihn.

### 👤 [Für Nutzer – herunterladen und loslegen](#für-nutzer)

### 🛠️ [Für Entwickler – Code, Tests und Spezifikationen](#für-entwickler)

---

> **Quellstand / Source status, 18.10.2026:** Der alte Maschinenweg gab nach Allow
> das echte Tresorgeheimnis als `access_token` zurück. In diesem Quellstand ist
> dieser Weg auf Core-, UI-, Client- und Relay-Ebene gesperrt. Ein geschützter
> API-Kern wird mit synthetischen Daten geprüft; produktive Geheimnisnutzung und
> geschützte Browser-Sitzungen sind noch nicht angeschlossen. / The legacy machine
> path returned the actual vault secret as `access_token` after Allow. This source
> disables that path across core, UI, client and relay. A protected API core is
> tested with synthetic data; production secret use and protected browser sessions
> are not connected. Existing v0.1.2-rc.2 downloads are unchanged and do not contain
> this source fix. See [boundary and evidence](docs/PROTECTED-ACCESS-20261018.md).
> Bedienbasis / UI foundation: Die vorhandene np-Gestaltung ist im Quellstand
> mit AP4 und bestehenden schmalen/Touch-Ansichten abgeglichen. / Source adopts
> the existing np foundation while preserving AP4 and narrow/touch behavior.
> [Design evidence](docs/DESIGN-ALIGNMENT-20261018.md); unchanged downloads remain
> separately pinned. Der [Bindungskern](protected_executor/README.md) verweigert
> fehlende Produktionshosts vor Zugriff; positive Proben bleiben explizit
> synthetisch. / The [binding core](protected_executor/README.md) denies missing
> production hosts before lookup; positive probes remain explicitly synthetic.

## Für Nutzer

### Einfach erklärt

Bei vielen Passwort-Apps liegen deine Daten bei einer Firma in der Cloud.
Bei 4AllPass liegt das Entscheidende bei dir: auf deinem Gerät und verschlüsselt.

**Das Produkt ist die Desktop-App.**

Du installierst sie, legst deinen Tresor an und übernimmst deine Passwörter aus dem Browser. Danach hilft dir 4AllPass beim Anmelden – ohne ständiges Kopieren und Einfügen.

### Was du davon hast

- Passwörter und Zugänge bleiben unter deiner Kontrolle.
- Autofill erledigt den Login für dich.
- Es gibt keinen verpflichtenden Cloud-Dienst.
- Synchronisierung ist optional und soll mit einem Server deiner Wahl funktionieren.
- Das Notfall-Kit ermöglicht Wiederherstellung ohne Server-Reset.
- KI-Tools erhalten später nur einzeln erlaubte Zugänge – niemals den ganzen Tresor.

### In drei Schritten

1. **Installieren** – Desktop-App herunterladen und starten.
2. **Übernehmen** – Passwörter aus Chrome oder Firefox prüfen und importieren.
3. **Anmelden** – Autofill auf einer Webseite ausprobieren.

[Desktop-Version herunterladen](https://github.com/landjunge/4AllPass/releases/tag/v0.1.2-rc.2) · [Produktseite ansehen](https://4allpass.netzwerkpunkt.de/)

### Was wir bewusst nicht machen

Wir bauen nicht gleichzeitig Blockchain, eine eigene digitale Identität und zwanzig Zukunftsfunktionen.

Zuerst muss 4AllPass im Alltag einfach und zuverlässig funktionieren: installieren, importieren, anmelden und wiederherstellen. Erst danach kommt mehr.

### Was heute funktioniert – ehrlich

| Bereich | Aktueller Stand |
|---|---|
| Produkt | Desktop-App; Entsperren mit Tresor-Passwort |
| Ablage | Local-first; Synchronisierung optional; kein angebotener Hosted-Dienst |
| Import | Chrome und Firefox; Prüfung ohne sichtbare Passwörter in der Liste |
| Autofill | Chromium, Firefox und Safari-Wrapper; kein automatisches Absenden |
| Zugriffsfreigabe | Zugriffe müssen lokal bestätigt werden |
| Recovery | Notfall-Kit; kein Zurücksetzen über den Server |
| WebAuthn PRF | Im Protokoll beschrieben; in der Desktop-Webview noch nicht bewiesen |
| Apple | Notarisierung wegen jährlicher Kosten pausiert |
| Sicherheitsprüfung | Noch kein unabhängiges Drittaudit |

Wichtig: 4AllPass ist noch eine Alpha-Version. Für wichtige Zugangsdaten braucht es weiterhin Vorsicht und ein sicheres Backup.

### Lizenz

**Netzwerkpunkt Personal Use License 1.0 — individuelle Source-available-Lizenz.**

Private, nicht geschäftliche Nutzung ist kostenlos erlaubt, einschließlich Installation, eigener privater Anpassungen und privatem Self-Hosting. Interner Firmeneinsatz, berufliche Nutzung, Weiterverkauf und kostenpflichtige Dienste benötigen eine vorherige schriftliche Erlaubnis beziehungsweise gesonderte Lizenz des Rechteinhabers. Es gibt keine allgemeine Weiterverteilungserlaubnis. Bereits erteilte Rechte historischer Fassungen bleiben erhalten.

Maßgeblich ist die [vollständige Lizenz auf Deutsch mit englischer Übersetzung](LICENSE). Dies ist keine Open-Source-Standardlizenz. Eine anwaltliche Prüfung wurde nicht durchgeführt. Vorhandene Downloads und ältere Releases können noch unter ihren damaligen Bedingungen stehen; diese Änderung schreibt ihre Lizenz nicht rückwirkend um.


---

## Installation

### macOS und Linux

~~~sh
curl -fsSL https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.sh | sh
~~~

### Windows

~~~powershell
irm https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.ps1 | iex
~~~

Dafür brauchst du kein Node, Python, Docker oder Postgres. Der Installer verwendet den GitHub-Tag **v0.1.2-rc.2** und prüft SHA-256. Der Tresor-Ordner wird nicht gelöscht.

Die macOS-App ist noch nicht notariert. Deshalb kann beim ersten Start **Rechtsklick → Öffnen** nötig sein.

---

## Für Entwickler

4AllPass ist ein local-first Passwort-Manager mit Desktop-App, Browser-Erweiterungen und optionalem verschlüsseltem Speicher.

Der Server sieht keinen Klartext, kein Tresor-Passwort und keinen Vault Key. Was die Software tatsächlich erzwingt, steht in [Security Boundary](docs/security-boundary.md).

### Wie dieses Projekt entsteht

**System Designer & Product Architect: Daniel Filipek (landjunge)**

Produktvision, gewünschtes Verhalten, Grenzen und Prioritäten kommen von mir. KI unterstützt mich bei Implementierung, Tests und Dokumentation.

Ich bin kein klassischer Softwareentwickler und kein Security-Spezialist. Deshalb müssen Code, Spezifikationen und Tests überprüfbar bleiben.

Ich behaupte nicht, dass die Kryptografie sicher ist. Es gibt noch kein unabhängiges Drittaudit. Reviews, Tests und Versuche, das System zu brechen, sind ausdrücklich willkommen.

### Entwicklungsumgebung

Die folgenden Werkzeuge brauchst du nur für den Source-Build:

~~~sh
git clone https://github.com/landjunge/4AllPass.git
cd 4AllPass
npm install
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cd ..
npm run build:extension
npm run tauri:dev
~~~

### Prüfen

~~~sh
npm test
npm run typecheck
cd backend && pytest
cd frontend && npm run test:e2e:user-watch
~~~

`test:e2e:user-watch` is opt-in, headed or screenshot-only, dummy vault — not the real Desk vault. See [docs/UI_TEST_SUITE.md](docs/UI_TEST_SUITE.md).

### Technische Dokumentation

- [Dokumentationsübersicht](docs/README.md)
- [Sicherheitsgrenze](docs/security-boundary.md)
- [Bedrohungsmodell](docs/threat-model.md)
- [Vault-Protokoll](docs/vault-protocol.md)
- [Recovery](docs/recovery.md)
- [Produktreife](docs/product-maturity.md)
- [Beitragen](CONTRIBUTING.md)
- [Sicherheitsprobleme melden](SECURITY.md)

Der Vault Key ist zufällig und wird niemals direkt aus dem Tresor-Passwort abgeleitet.

---

## English

4AllPass is a local-first desktop password manager. Autofill. Zero-knowledge. AI access is blocked without a protected execution path.

Import passwords from Chrome or Firefox, keep the vault on your device, and optionally self-host sync. There is no hosted cloud service. This is still alpha — there is no independent third-party audit yet.

Start with the [desktop release](https://github.com/landjunge/4AllPass/releases/tag/v0.1.2-rc.2). Product page: [4allpass.netzwerkpunkt.de](https://4allpass.netzwerkpunkt.de/). Technical details are in the [documentation index](docs/README.md).

**License: Netzwerkpunkt Personal Use License 1.0 — custom source-available terms.**

Private, non-business use is free, including installation, private modifications and private self-hosting. Internal business or professional use, resale and paid services require prior written permission or a separate license from the rightsholder. No general redistribution permission is granted. Historical license grants remain intact.

See the [full German license and English translation](LICENSE); the German text governs. This is not a standard open-source license and has not undergone legal review. Existing downloads and older releases may retain their original terms; this change does not retroactively relicense them.


---

**4AllPass beantwortet eine Frage: Darf ich zugreifen?**
Teil von [Netzwerkpunkt](https://netzwerkpunkt.de/) – eigenständig, local-first und unter deiner Kontrolle.
