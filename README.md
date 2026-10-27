# 4AllPass

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/design/icons/dark/4AllPass-dark-128.png">
  <img src="assets/design/icons/light/4AllPass-light-128.png" alt="4AllPass" width="96" height="96">
</picture>



<p align="center"><strong>Ein digitaler Tresor, der wirklich dir gehört.</strong></p>

Lokaler Passwort-Manager. Autofill. Zero-Knowledge. KI-Zugriff ohne geschützten Nutzungsweg gesperrt.

4AllPass speichert Passwörter und Zugänge auf deinem Gerät. Ein Anbieter oder Server soll sie nicht lesen können. Das gilt für die **App auf dem Gerät**. Eine vom Storage-Server gelieferte PWA kann der Betreiber tauschen — das ist kein Zero-Knowledge gegen ihn.

### 👤 [Für Nutzer – herunterladen und loslegen](#für-nutzer)

### 🛠️ [Für Entwickler – Code, Tests und Spezifikationen](#für-entwickler)

---

> **Quellstand, 18.10.2026:** Der alte Maschinenweg gab nach Allow das echte
> Tresorgeheimnis als `access_token` zurück. In diesem Quellstand ist dieser Weg
> auf Core-, UI-, Client- und Relay-Ebene gesperrt. Ein geschützter API-Kern wird
> mit synthetischen Daten geprüft; produktive Geheimnisnutzung und geschützte
> Browser-Sitzungen sind noch nicht angeschlossen. Die vorhandenen Downloads
> von v0.1.2-rc.2 bleiben unverändert und enthalten diese spätere Quellkorrektur
> nicht. [Grenzen und Belege](docs/PROTECTED-ACCESS-20261018.md).
> Die vorhandene np-Bedienbasis ist mit AP4 und bestehenden schmalen/Touch-
> Ansichten abgeglichen. [Gestaltungsbelege](docs/DESIGN-ALIGNMENT-20261018.md).
> Downloads behalten ihre getrennten Pins. Der [Bindungskern](protected_executor/README.md)
> verweigert fehlende Produktionshosts vor Zugriff; positive Proben bleiben
> ausdrücklich synthetisch.

## Aktueller Funktionsstand

4AllPass ist ein lokaler Passwort-Tresor mit Desktop-App, Browser-Import und Autofill. Im aktuellen Quellstand ist die frühere Übergabe echter Tresorgeheimnisse an KI-Clients gesperrt. Ein begrenzter geschützter API-Kern und seine TollGate-Anbindung wurden mit synthetischen Daten geprüft. Produktive Geheimnisnutzung und geschützte KI-Browser-Sitzungen sind noch nicht angeschlossen.

Quellstand und veröffentlichte Downloads sind getrennt: Die bestehenden v0.1.2-rc.2-Pakete enthalten diese spätere Quellkorrektur nicht automatisch. [Nachweise und Grenzen](docs/PROTECTED-ACCESS-20261018.md).

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
| KI-Zugriff | Im aktuellen Quellstand gesperrt; geschützter Produktionsweg fehlt |
| Recovery | Notfall-Kit; kein Zurücksetzen über den Server |
| WebAuthn PRF | Im Protokoll beschrieben; in der Desktop-Webview noch nicht bewiesen |
| Apple | Notarisierung wegen jährlicher Kosten pausiert |
| Sicherheitsprüfung | Noch kein unabhängiges Drittaudit |

Wichtig: 4AllPass ist noch eine Alpha-Version. Für wichtige Zugangsdaten braucht es weiterhin Vorsicht und ein sicheres Backup.

### Lizenz

**Netzwerkpunkt Personal Use License 1.0 — individuelle Lizenz mit einsehbarem Quelltext.**

Private, nicht geschäftliche Nutzung ist kostenlos erlaubt, einschließlich Installation, eigener privater Anpassungen und privatem Self-Hosting. Interner Firmeneinsatz, berufliche Nutzung, Weiterverkauf und kostenpflichtige Dienste benötigen eine vorherige schriftliche Erlaubnis beziehungsweise gesonderte Lizenz des Rechteinhabers. Es gibt keine allgemeine Weiterverteilungserlaubnis. Bereits erteilte Rechte historischer Fassungen bleiben erhalten.

Maßgeblich ist die [vollständige deutsche Lizenz](LICENSE). Dies ist keine Open-Source-Standardlizenz. Eine anwaltliche Prüfung wurde nicht durchgeführt. Vorhandene Downloads und ältere Releases können noch unter ihren damaligen Bedingungen stehen; diese Änderung schreibt ihre Lizenz nicht rückwirkend um.

[Lizenzhistorie und Drittbestandteile](docs/LICENSE-HISTORY-AND-THIRD-PARTY.md) dokumentiert feste Quellbelege und offene Auslieferungsprüfungen.


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

Der Server sieht keinen Klartext, kein Tresor-Passwort und keinen Vault Key. Was die Software tatsächlich erzwingt, steht in [Sicherheitsgrenze](docs/security-boundary.md).

### Wie dieses Projekt entsteht

**Systementwurf und Produktarchitektur: Daniel Filipek (landjunge)**

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

`test:e2e:user-watch` ist optional und läuft mit sichtbarem Browser oder nur für Bildschirmaufnahmen mit einem Testtresor. Der echte persönliche Tresor wird dabei nicht verwendet. Siehe [docs/UI_TEST_SUITE.md](docs/UI_TEST_SUITE.md).

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

**4AllPass beantwortet eine Frage: Darf ich zugreifen?**
Teil von [Netzwerkpunkt](https://netzwerkpunkt.de/) – eigenständig, local-first und unter deiner Kontrolle.
