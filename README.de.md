[English](README.md) · **Deutsch**

<p align="center">
  <img src="assets/design/icons/dark/4AllPass-dark-256.png" alt="4AllPass" width="256" height="256">
</p>

<p align="center">
  <a href="https://github.com/landjunge/threaddesk/blob/docs/product-family-readme-20261031/README.de.md" title="ThreadDesk"><img src="assets/readme/ThreadDesk-dark-128.png" alt="ThreadDesk" width="48" height="48"></a>
  &nbsp;
  <a href="https://github.com/landjunge/KiraBridge/blob/docs/product-family-readme-20261031/README.de.md" title="KiraBridge"><img src="assets/readme/KiraBridge-dark.svg" alt="KiraBridge" width="48" height="48"></a>
  &nbsp;
  <a href="https://github.com/landjunge/tollgate/blob/docs/product-family-readme-20261031/README.de.md" title="TollGate"><img src="assets/readme/TollGate-dark-128.png" alt="TollGate" width="48" height="48"></a>
  &nbsp;
  <a href="https://github.com/landjunge/agent-authority-lab/blob/docs/product-family-readme-20261031/README.de.md" title="Agent Authority"><img src="assets/readme/Agent-Authority-dark.svg" alt="Agent Authority" width="48" height="48"></a>
</p>

<h1 align="center">4AllPass</h1>

<p align="center"><strong>Ein digitaler Tresor, der wirklich dir gehört.</strong></p>

4AllPass verwaltet Passwörter und Zugänge verschlüsselt auf deinem Gerät. Die Desktop-App hilft dir beim Import und beim Ausfüllen von Anmeldedaten. Ein verpflichtender Cloud-Dienst gehört nicht dazu.

**Veröffentlicht: [0.1.2-rc.2](https://github.com/landjunge/4AllPass/releases/tag/v0.1.2-rc.2) · 18. Oktober 2026 · Alpha / Vorabversion**

[macOS Intel](https://github.com/landjunge/4AllPass/releases/download/v0.1.2-rc.2/4AllPass_0.1.2-rc.2_x64.dmg) · [macOS Apple Silicon](https://github.com/landjunge/4AllPass/releases/download/v0.1.2-rc.2/4AllPass_0.1.2-rc.2_aarch64.dmg) · [Windows x64](https://github.com/landjunge/4AllPass/releases/download/v0.1.2-rc.2/4AllPass_0.1.2-rc.2_x64-setup.exe) · [Linux x64](https://github.com/landjunge/4AllPass/releases/download/v0.1.2-rc.2/4AllPass_0.1.2-rc.2_amd64.AppImage)

[Prüfsummen](https://github.com/landjunge/4AllPass/releases/download/v0.1.2-rc.2/SHA256SUMS) · [Alle Downloads und Plattformbelege](https://github.com/landjunge/4AllPass/releases/tag/v0.1.2-rc.2)

**KI-Zugriff: Quellstand und Download unterscheiden sich.** Der aktuelle Quellstand sperrt die frühere Übergabe echter Tresorgeheimnisse an KI-Clients. Die veröffentlichten RC2-Pakete enthalten diese spätere Sperre nicht; ihr alter Weg konnte nach „Allow“ echte Zugangsdaten herausgeben. Verwende diesen alten Weg nicht für KI-Zugriffe. Ein geschützter Produktionsweg ist noch nicht angeschlossen. [Stand und Grenzen](docs/PROTECTED-ACCESS-20261018.md).

## Was heute vorhanden ist

- **Desktop-Tresor:** lokal speichern und mit dem Tresor-Passwort entsperren.
- **Browser-Import:** Passwörter aus Chrome und Firefox prüfen und übernehmen.
- **Autofill:** Zugangsdaten über Browser-Erweiterungen eintragen, ohne automatisch abzusenden.
- **Wiederherstellung:** Notfall-Kit statt Zurücksetzen durch einen Server; Synchronisierung ist optional, ein gehosteter Dienst wird nicht angeboten.

Der geschützte API-Kern und seine TollGate-Anbindung sind im Quellstand mit synthetischen Daten geprüft. Produktive KI-Geheimnisnutzung und geschützte KI-Browser-Sitzungen bleiben geplant. Die Verschlüsselungsgrenze gilt für die gebündelte Desktop-App; eine vom Server gelieferte Web-App kann dessen Betreiber verändern. [Sicherheitsgrenze](docs/security-boundary.md).

## Loslegen

1. **Installieren.** Lade das Paket für deinen Rechner und vergleiche seine SHA-256-Prüfsumme. Sichere einen bestehenden Tresor vor dem Update.
2. **Tresor anlegen.** Wähle ein eigenes Tresor-Passwort und bewahre das Notfall-Kit sicher auf.
3. **Anmelden ausprobieren.** Importiere zunächst Testdaten und richte die passende Browser-Erweiterung ein. [Bedienung und Einrichtung](docs/README-HUMAN.md).

Die macOS-App ist nicht Apple-notarisiert, Windows-Pakete sind nicht signiert. Es gibt noch kein unabhängiges Drittaudit. Touch ID beziehungsweise WebAuthn-PRF ist im Desktop noch nicht als Entsperrweg bewiesen. [Produktreife](docs/product-maturity.md).

## Geplante Zusammenarbeit

Die fünf Produkte bleiben eigenständig. Geplant ist ein gemeinsamer Ablauf mit **KiraBridge als Kommunikationszentrale**:

| Produkt | Aufgabe im gemeinsamen Ablauf |
| --- | --- |
| [ThreadDesk](https://github.com/landjunge/threaddesk/blob/docs/product-family-readme-20261031/README.de.md) | Bewahrt Projektstand, Wissen und Ergebnisse. |
| [KiraBridge](https://github.com/landjunge/KiraBridge/blob/docs/product-family-readme-20261031/README.de.md) | Vermittelt Aufträge, Rückfragen und Antworten zwischen Chat, lokalen Agenten und Werkzeugen. |
| [4AllPass](https://github.com/landjunge/4AllPass/blob/docs/product-family-readme-20261031/README.de.md) | Verwaltet Zugangsdaten; soll gezielt erlaubte Zugriffe ermöglichen. |
| [TollGate](https://github.com/landjunge/tollgate/blob/docs/product-family-readme-20261031/README.de.md) | Prüft angeschlossene Aufrufe und setzt Verbrauchsgrenzen und Stopps durch. |
| [Agent Authority](https://github.com/landjunge/agent-authority-lab/blob/docs/product-family-readme-20261031/README.de.md) | Zeigt Beobachtungen, Widersprüche und fehlende Belege; erteilt keine Freigaben. |

Einzelne Schnittstellen sind vorhanden. Ein vollständig eingerichteter und geprüfter Ablauf aller fünf Produkte ist noch geplant. Freigaben bleiben beim zuständigen Werkzeug und beim Menschen. KiraBridge und Agent Authority benötigen Zugriff auf ihre privaten Repositorys.

[Dokumentation](docs/README.md) · [Entwicklerinstallation und Beiträge](docs/DEVELOPERS.md) · [Sicherheitsprobleme melden](SECURITY.md) · [Produktseite](https://4allpass.netzwerkpunkt.de/)

## Lizenz und Mitwirkung

Private, nicht geschäftliche Nutzung ist unter der [Netzwerkpunkt Personal Use License 1.0](LICENSE) kostenlos. Geschäftliche Nutzung benötigt eine gesonderte schriftliche Erlaubnis. Der deutsche Lizenztext ist maßgeblich; historische Lizenzrechte bleiben erhalten.

Produktidee und Architektur: **Daniel Filipek (landjunge)**. KI unterstützt Implementierung und Dokumentation. Rückmeldungen und nachvollziehbare Reviews sind willkommen.
