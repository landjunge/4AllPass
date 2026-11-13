<!-- readme-header-v1: Kopf nach ThreadDesk docs/contracts/readme-header-v1.md. Nicht von Hand umgestalten; scripts/readme_header.py apply/check verwenden. -->

<p align="center">
  <img src="assets/readme/normalized/4AllPass-large.svg" alt="4AllPass" width="256" height="256">
</p>

<p align="center">
  <a href="https://github.com/landjunge/KiraBridge#readme" title="KiraBridge"><img src="assets/readme/normalized/KiraBridge-small.svg" alt="KiraBridge" width="48" height="48"></a>
  &nbsp;
  <a href="https://github.com/landjunge/threaddesk#readme" title="ThreadDesk"><img src="assets/readme/normalized/ThreadDesk-small.svg" alt="ThreadDesk" width="48" height="48"></a>
  &nbsp;
  <a href="https://github.com/landjunge/tollgate#readme" title="TollGate"><img src="assets/readme/normalized/TollGate-small.svg" alt="TollGate" width="48" height="48"></a>
  &nbsp;
  <a href="https://github.com/landjunge/agent-authority-lab#readme" title="Agent Authority"><img src="assets/readme/normalized/Agent-Authority-small.svg" alt="Agent Authority" width="48" height="48"></a>
  &nbsp;
  <a href="https://github.com/landjunge/blockdesign#readme" title="BlockDesign"><img src="assets/readme/normalized/BlockDesign-small.svg" alt="BlockDesign" width="48" height="48"></a>
</p>

<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/design/wordmarks/4AllPass-dark.svg"><img src="assets/design/wordmarks/4AllPass-light.svg" alt="4AllPass" width="280"></picture></p>

<!-- AUTO-DOWNLOADS:START -->
<p align="center">
  <a href="https://github.com/landjunge/4AllPass/releases/download/v0.1.2-rc.3/4AllPass_0.1.2-rc.3_aarch64.dmg" title="4AllPass_0.1.2-rc.3_aarch64.dmg herunterladen / download"><img src="assets/readme/download-macos-apple-silicon.svg" alt="Download macOS Apple Silicon 0.1.2-rc.3" width="190" height="52"></a>
  &nbsp;
  <a href="https://github.com/landjunge/4AllPass/releases/download/v0.1.2-rc.3/4AllPass_0.1.2-rc.3_x64.dmg" title="4AllPass_0.1.2-rc.3_x64.dmg herunterladen / download"><img src="assets/readme/download-macos-intel.svg" alt="Download macOS Intel 0.1.2-rc.3" width="190" height="52"></a>
  &nbsp;
  <a href="https://github.com/landjunge/4AllPass/releases/download/v0.1.2-rc.3/4AllPass_0.1.2-rc.3_x64-setup.exe" title="4AllPass_0.1.2-rc.3_x64-setup.exe herunterladen / download"><img src="assets/readme/download-windows.svg" alt="Download Windows 0.1.2-rc.3" width="190" height="52"></a>
  &nbsp;
  <a href="https://github.com/landjunge/4AllPass/releases/download/v0.1.2-rc.3/4AllPass_0.1.2-rc.3_amd64.AppImage" title="4AllPass_0.1.2-rc.3_amd64.AppImage herunterladen / download"><img src="assets/readme/download-linux.svg" alt="Download Linux 0.1.2-rc.3" width="190" height="52"></a>
</p>
<!-- AUTO-DOWNLOADS:END -->

> **Sicherheitshinweis zu 0.1.2-rc.3 und älteren Vorabversionen:** 0.1.2-rc.3 ist
> zum Download verfügbar und schließt den Maschinenzugriff: Jede Anfrage wird
> abgelehnt, auch nach „Erlauben“. Betroffen sind 0.1.2-rc.2 und ältere
> Vorabversionen (v0.1.0, v0.1.1, desktop); dort gab der Maschinenzugriff nach
> „Erlauben“ das echte gespeicherte Geheimnis als `access_token` an das verbundene
> Programm weiter. Wer das dort erlaubt hat, sollte aktualisieren und den Zugang
> beim jeweiligen Anbieter ändern oder widerrufen. Ein Update holt bereits
> herausgegebene Kopien nicht zurück.
> [Details](docs/release-notes/0.1.2-rc.2-security-notice.md)
>
> **Security notice for 0.1.2-rc.3 and older previews:** 0.1.2-rc.3 is available
> for download and closes the machine-access path: every request is denied,
> including after "Allow". 0.1.2-rc.2 and older previews (v0.1.0, v0.1.1, desktop)
> are affected; there, after "Allow", machine access passed the actual stored
> secret to the connected program as `access_token`. If you allowed that, update
> and change or revoke the credential at its provider. Updating does not recall
> copies already handed out.
> [Details](docs/release-notes/0.1.2-rc.2-security-notice.md)

<p align="center"><strong>Ein digitaler Tresor, der wirklich dir gehört.</strong></p>

## Auf einen Blick / At a glance

**Deutsch:** 4AllPass ist ein lokaler Passwort-Tresor mit Desktop-Oberfläche, Browser-Import und Autofill. Die Vorabversion 0.1.2-rc.3 ist für macOS Apple Silicon, macOS Intel, Windows x64 und Linux x64 AppImage verfügbar und schließt den Maschinenzugriff: Jede Anfrage wird abgelehnt, auch nach „Erlauben“.

**English:** A local password vault with a desktop interface, browser import and autofill. Preview 0.1.2-rc.3 is available for macOS Apple Silicon, macOS Intel, Windows x64 and Linux x64 AppImage and closes the machine-access path: every request is denied, including after "Allow".

**Sicherheit / Security:** Die vier Download-Schaltflächen oben führen zu 0.1.2-rc.3. 0.1.2-rc.2 und ältere Vorabversionen (v0.1.0, v0.1.1, desktop) bleiben betroffen: Wer dort einem Programm Zugriff erlaubt hat, sollte aktualisieren und die Zugangsdaten beim jeweiligen Anbieter ändern oder widerrufen. / The four download buttons above point to 0.1.2-rc.3. 0.1.2-rc.2 and older previews (v0.1.0, v0.1.1, desktop) remain affected: if you allowed access there, update and change or revoke the credential at its provider. [Release-Übersicht / Releases](https://github.com/landjunge/4AllPass/releases)

## Werkzeugfamilie: Zugang zur Computersteuerung sicher organisieren

**KiraBridge verbindet die NetzwerkPunkt-Werkzeugfamilie über ChatGPT mit Sprache, Chat und direkter Computersteuerung.** Dazu zählen unter passenden Berechtigungen das Öffnen von Programmen, Fensterwechsel, Notizen, direkte Texteingabe und Tastenkombinationen. **4AllPass hat darin eine andere, klar abgegrenzte Aufgabe:** Es verwaltet Zugänge, Schlüssel und Identitäten für angebundene Werkzeuge. Ein Sprachbefehl soll niemals schon deshalb Zugriff auf geheime Daten gewähren, weil er bequem formuliert wurde.

Zur Familie gehören **KiraBridge** (Verbindung und Computersteuerung), **ThreadDesk** (Projekte und Arbeitsstände), **4AllPass** (Zugänge und Schlüssel), **TollGate** (Nutzungsgrenzen und Budgets) und **Agent Authority** (nur Beobachtung und Nachweise). Jedes Werkzeug behält eigene Zuständigkeiten und Berechtigungen. Die gemeinsame sprachgesteuerte Bedienung ist das übergreifende Entwicklungsziel; einzelne Integrationen werden nur als verfügbar beschrieben, wenn sie tatsächlich nachgewiesen sind.

## Sichere Zugänge für sprachgesteuerte Abläufe

**Das gemeinsame Hauptziel ist, Computer und Werkzeuge über natürliche Sprache für alle Menschen bedienbar zu machen.** KiraBridge übernimmt die Sprach- und Computersteuerung; 4AllPass verwaltet die dafür benötigten Zugänge, Schlüssel und Identitäten nach eigenen Sicherheitsregeln. Sprachbefehle sollen Abläufe vereinfachen, aber niemals Berechtigungen, Authentifizierung oder bewusste Freigaben umgehen.

**Barrierefreiheit wird als wichtiger zusätzlicher Nutzen mitgedacht, nicht als alleinige Zielgruppe oder primärer Produktzweck.** Wer Schwierigkeiten mit Maus oder Tastatur hat, kann besonders von verständlichen, sprachgestützten Abläufen profitieren; auch freihändige und alltägliche Bedienung wird leichter. Sensible Freigaben und Geheimnisse bleiben geschützt. Bestehende Möglichkeiten, Risiken und geplante Verbesserungen sind klar zu trennen.

**Wichtig:** 0.1.2-rc.2 und ältere Vorabversionen (v0.1.0, v0.1.1, desktop) bleiben vom Maschinenzugriff betroffen: Dort kann ein freigegebener Zugriff das gespeicherte Geheimnis an das verbundene Programm weitergeben. 0.1.2-rc.3 schließt diesen Weg; wer dort einem Programm Zugriff erlaubt hat, sollte aktualisieren und den Zugang beim jeweiligen Anbieter ändern oder widerrufen. Die Sprachvision ändert nichts an dieser Grenze.

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

## Ältere Tresore aktualisieren / Updating older vaults

**Deutsch:** Ältere Tresore ohne Manifest bleiben lesbar. Ein Banner bietet
„Jetzt aktualisieren“ oder „Später“; ohne deine Bestätigung wird nichts migriert.
Vor dem Update legt 4AllPass eine verschlüsselte lokale Sicherung des alten
Stands ab. Der bisherige Serverstand lässt sich nicht nachträglich beweisen; das
Update versiegelt den aktuell geöffneten Inhalt für die Zukunft. Bleibt der
Ausgang unklar, sendet die App ohne positiven Beleg nichts weiter.

**English:** Older vaults without a manifest remain readable. A banner offers
“Update now” or “Later”; nothing is migrated without your confirmation. Before
updating, 4AllPass stores an encrypted local backup of the old state. The
previous server state cannot be proven retroactively; the update seals the
currently opened content for the future. If the outcome becomes unknown, the app
sends nothing further without positive proof.

## Aktueller Funktionsstand / Current capabilities

**Deutsch:** 4AllPass ist ein lokaler Passwort-Tresor mit Desktop-App, Browser-Import und Autofill. Im aktuellen Quellstand ist die frühere Übergabe echter Tresorgeheimnisse an KI-Clients gesperrt. Ein begrenzter geschützter API-Kern und seine TollGate-Anbindung wurden mit synthetischen Daten geprüft. Produktive Geheimnisnutzung und geschützte KI-Browser-Sitzungen sind noch nicht angeschlossen.

**English:** 4AllPass is a local password vault with a desktop app, browser import and autofill. Current source blocks the former handoff of actual vault secrets to AI clients. A bounded protected API core and its TollGate adapter were tested with synthetic data. Production secret use and protected AI browser sessions are not connected yet.

Quellstand und veröffentlichte Downloads sind getrennt: Die bestehenden v0.1.2-rc.2-Pakete enthalten diese spätere Quellkorrektur nicht automatisch. / Source and distributed downloads are separate: existing v0.1.2-rc.2 packages do not automatically include the later source correction. [Nachweise und Grenzen / Evidence and limits](docs/PROTECTED-ACCESS-20261018.md).

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

[Desktop-Version herunterladen](https://github.com/landjunge/4AllPass/releases/tag/v0.1.2-rc.3) · [Produktseite ansehen](https://4allpass.netzwerkpunkt.de/)

Vor dem Download von 0.1.2-rc.3: [Sicherheitshinweis zum Maschinenzugriff](docs/release-notes/0.1.2-rc.2-security-notice.md) lesen.

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
| Frühere Stände | Einstellungen → Sicherheit: ältere Stände ansehen und einen fehlenden Eintrag einzeln wiederherstellen; immer als neuer Stand, nie zurückgedreht |
| Aufräumen | Vorschau unter Einstellungen → Sicherheit: zeigt nach ausdrücklichem Klick ähnliche Einträge und lange unveränderte Einträge mit ihrem Alter; reine Anzeige, keine Änderung |
| Sicherung | Verschlüsselte Gesamtsicherung als Datei (nur Chiffretext) mit Integritätsprüfung und Wiederherstellung als neuer Stand; auf einem anderen Gerät braucht es Master-Passwort oder Recovery-Kit |
| Produktleiste | Fünf-Produkt-Appbar im Kopf (eigene Wortmarke, mittige Original-Icons, DE/EN); Wechsel ruft den nativen `family_switch`-Host nur mit Katalog-ID auf — im Browser ehrlich deaktiviert, „App geöffnet“ ist nicht „verbunden“ |
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

Dafür brauchst du kein Node, Python, Docker oder Postgres. Der Installer verwendet den GitHub-Tag **v0.1.2-rc.3** und prüft SHA-256. Der Tresor-Ordner wird nicht gelöscht. Für diese Version gilt der [Sicherheitshinweis zum Maschinenzugriff](docs/release-notes/0.1.2-rc.2-security-notice.md).

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

Import passwords from Chrome or Firefox, keep the vault on your device, and optionally self-host sync. Under Settings → Security, earlier states can be viewed and a missing entry restored individually (always as a new state), a read-only cleanup preview lists similar and long-unchanged entries, and an encrypted full backup can be created and restored (ciphertext only; another device needs the master password or recovery kit). There is no hosted cloud service. This is still alpha — there is no independent third-party audit yet.

Start with the [desktop release](https://github.com/landjunge/4AllPass/releases/tag/v0.1.2-rc.3); read its [machine-access security notice](docs/release-notes/0.1.2-rc.2-security-notice.md) first. Product page: [4allpass.netzwerkpunkt.de](https://4allpass.netzwerkpunkt.de/). Technical details are in the [documentation index](docs/README.md).

**License: Netzwerkpunkt Personal Use License 1.0 — custom source-available terms.**

Private, non-business use is free, including installation, private modifications and private self-hosting. Internal business or professional use, resale and paid services require prior written permission or a separate license from the rightsholder. No general redistribution permission is granted. Historical license grants remain intact.

See the [full German license and English translation](LICENSE); the German text governs. This is not a standard open-source license and has not undergone legal review. Existing downloads and older releases may retain their original terms; this change does not retroactively relicense them.


---

**4AllPass beantwortet eine Frage: Darf ich zugreifen?**
Teil von [Netzwerkpunkt](https://netzwerkpunkt.de/) – eigenständig, local-first und unter deiner Kontrolle.
