# Lizenzhistorie und Drittbestandteile

Geprüft am 27.10.2026; Ausgangsstand
`0b66a2fda7fcc831762e732eb20084137fa6029d`.
Diese Übersicht dokumentiert Belege und offene Auslieferungsprüfungen. Sie
erteilt keine neue Lizenz und bestätigt keine lückenlose Rechteinhaberschaft.

## Aktuelle Bedingungen

Die [LICENSE](../LICENSE) enthält die Netzwerkpunkt Personal Use License 1.0,
Copyright Daniel Filipek / landjunge. Die bereits zuvor maßgebliche deutsche
Fassung ist unverändert erhalten. Auf ausdrücklichen Wunsch des Nutzers enthält
die aktuelle Datei nur diese deutsche Fassung. Die bisherige englische
Übersetzung und alle historischen Texte bleiben in Git erhalten. Die deutsche
Sprachvereinheitlichung führt keine neue Lizenz ein.

§5 erhält historische PolyForm-Rechte und andere bestehende Erlaubnisse.
README, die neun eigenen npm-Manifeste und deren Workspaceeinträge im npm-Lock
stimmen damit überein: `SEE LICENSE IN` verweist jeweils auf die Root-LICENSE.
Cargo verwendet `license-file = "../LICENSE"`, Tauri
`LicenseRef-Netzwerkpunkt-Personal-Use-1.0` und denselben `licenseFile`-Pfad.
Lizenzname und technische Referenzen bleiben unverändert.

## Belegte Historie

| Grenze in der heutigen main-Historie | Beleg |
| --- | --- |
| Frühere Paketmetadaten | Eigene Kernpakete verwendeten `UNLICENSED`; anderen frühen Manifesten fehlte ein Lizenzfeld. Dies belegt keine allgemeine MIT-Freigabe. |
| 30.08.2026, 16:19:15 UTC | [`44ad4b2597b45405147e44426714d903c72725f1`](https://github.com/landjunge/4AllPass/commit/44ad4b2597b45405147e44426714d903c72725f1) führt PolyForm Noncommercial 1.0.0 in main ein. Frontend-/Extension-Metadaten folgen in [`e32f2783cc1e30e9188e4d5160528fe8a3b9148a`](https://github.com/landjunge/4AllPass/commit/e32f2783cc1e30e9188e4d5160528fe8a3b9148a). |
| 07.10.2026, 14:57:09 UTC | [`accb7a7e3ca8bc1596ddb74a5cb1ca160c38c01f`](https://github.com/landjunge/4AllPass/commit/accb7a7e3ca8bc1596ddb74a5cb1ca160c38c01f) führt den Rechtevorbehalt unter Erhalt früherer PolyForm-Rechte ein. Sein Parent [`47cc823d36f7731001a83f7fbda87d38ccc8e9b4`](https://github.com/landjunge/4AllPass/blob/47cc823d36f7731001a83f7fbda87d38ccc8e9b4/LICENSE) enthält den genauen früheren Lizenztext einschließlich Required Notice. |
| 18.10.2026, 12:12:41 UTC | [`f184ade1443d344fc6c727e0833af8b601eb06f1`](https://github.com/landjunge/4AllPass/commit/f184ade1443d344fc6c727e0833af8b601eb06f1) übernimmt die aktuelle Privatnutzungslizenz mit Erhalt bestehender Erlaubnisse. Die ursprüngliche deutsche Fassung und ihre damalige englische Übersetzung sind dort erhalten. |
| Öffentlicher Release | [`v0.1.2-rc.2`](https://github.com/landjunge/4AllPass/releases/tag/v0.1.2-rc.2), gebauter Quellpin `60eef0a7cc522c83dd13842c82c63a4430eb256f`, enthält die damalige separate LICENSE und vier Drittanbieter-Hinweisarchive. [Vorhandene Releasebelege](LICENSE-RELEASE-20261018.md) unterscheiden Quellstand, Kandidaten und veröffentlichte Pakete. |

Commitdaten belegen Quelländerungen, nicht jeden Veröffentlichungszeitpunkt oder
Empfänger. Auch frühere Arbeitsbranchfassungen und einzelne verteilte Pakete
müssen nach den tatsächlich mitgegebenen Bedingungen beurteilt werden. Der
PolyForm-Text steht bereits im früheren Arbeitsbranch-Commit
`b54b9f7c2e7a2fdf9e768e8e392f8333f7433e34`; die Tabelle behauptet keine globale
erstmalige Veröffentlichung. PolyForm Noncommercial ist nicht mit der heutigen
engeren privaten Nutzung gleichzusetzen. Gültig eingeräumte historische Rechte
werden durch neue Commits, die Sprachvereinheitlichung oder einen späteren
Verkauf nicht umgeschrieben. Historische Pakete behalten ihre damaligen Texte.

## Fremdlizenzen und erforderliche Hinweise

| Belegter Bereich | Erforderliche Auslieferungsprüfung |
| --- | --- |
| npm- und Cargo-Locks | Tatsächliche Einbindung je Laufzeit-, Bau- und optionalem Ziel bestimmen. Vorgeschriebene Original-Lizenz-, Copyright- und NOTICE-Texte für weitergegebene Komponenten erhalten. Ein Lockeintrag beweist keine Einbindung in jedes Binary. |
| MPL-2.0-Komponenten | Cargo-Kandidatenmetadaten erfassen cssparser 0.36.0, cssparser-macros 0.6.1, dtoa-short 0.3.5, option-ext 0.2.0, selectors 0.36.1. npm erfasst lightningcss 1.33.0 als Bauwerkzeug. Hinweise und Quellverfügbarkeit tatsächlich weitergegebener erfasster Dateien prüfen; die MPL lizenziert nicht automatisch alle eigenen Dateien um. [MPL-FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/). |
| Psycopg 3.2.4 | `backend/requirements.txt` deklariert `psycopg[binary]==3.2.4`; Kandidatenhinweise nennen psycopg/psycopg-binary unter LGPL-3.0. Tatsächliche Einbindung, Original- und native Begleithinweise, erforderliche Quell-/Ersatz-/Relinkingmöglichkeiten und EULA-Verträglichkeit vor Weitergabe prüfen. [Originallizenz](https://github.com/psycopg/psycopg/blob/3.2.4/LICENSE.txt). |
| PyInstaller-Verpackung | Kandidatenmetadaten nennen 6.22.2 mit Ausnahme für kommerzielle Bündelung. Diese Ausnahme beseitigt keine Pflichten anderer mitgelieferter Bibliotheken. [Offizielle Bedingungen](https://pyinstaller.org/en/stable/license.html). |
| r-efi | Kandidatenmetadaten nennen `MIT OR Apache-2.0 OR LGPL-2.1-or-later`; zulässige Wahl für tatsächlich enthaltene Komponenten dokumentieren, keine kumulative Pflicht aller Alternativen behaupten. |
| SecLists-Blocklist | `backend/app/core/_account_password_blocklist.py` enthält Daniel Miesslers unveränderten MIT-Hinweis mit Quellcommit/-hash. Diesen fremden Originaltext erhalten; es handelt sich um fremdes Datenmaterial. |
| Optionaler Redis-Server | `deploy/compose.yml` deklariert den beweglichen Tag `redis:7-alpine`. Tatsächliche Version und Digest samt Serverbedingungen vor Lieferung oder Hosting feststellen. Die MIT-Lizenz des gesonderten redis-py-Clients bestimmt nicht die Serverlizenz. [Redis-Lizenzmatrix](https://redis.io/legal/licenses/). |
| Native Ebene, Betriebssystem, Container und Assets | Tatsächlich enthaltene GTK-/GLib-/WebKitGTK-/WebView2-/Apple-Laufzeitteile und Containerlayer mit ihren Bedingungen prüfen. `brand/README.md` dokumentiert Herkunft, keine Markenfreigabe oder vollständige Rechtekette. |

Die vorhandene Sammlung durch `scripts/collect-release-notices.py` erfasst das
Buildumfeld einschließlich Buildwerkzeugen. Sie ist keine finale Runtime-SBOM.
Die vorhandenen RC3-Kandidateninventare erfassen 924–928 Komponenten; bei
53–57 Einträgen pro Ziel fehlt dort ein Hinweistext. Alle 1306–1312 bereits
referenzierten Dateien je Ziel wurden am Prüfdatum gefunden und ihre Hashes
bestätigt. Das schließt die verbleibenden Lücken nicht. Vor Auslieferung sind
fehlende Texte je tatsächlich enthaltenem Bestandteil zu klären, erforderliche
Quellhinweise/-angebote bereitzustellen und native Ebenen zu ergänzen. RC3 ist
ein Kandidat und wird hier nicht als neuer veröffentlichter Release bezeichnet.
Die reine Hashprüfung vorhandener Hinweise ist kein vollständiger Nachweis
der Lizenzkonformität. Fremde Originaltexte bleiben in ihrer Sprache erhalten.

## Vorbereitung einer Transaktion

Eigene wirtschaftliche Nutzungsrechte, frühere PolyForm-/Individualrechte und
Fremdrechte müssen getrennt in die Vertragsanlage. Beiträge, Arbeits-/Auftrags-
bezüge und KI-/Referenzherkunft sind anhand tatsächlicher Unterlagen zu prüfen.
Eine Käuferlizenz mit Bearbeitungs-, Übertragungs-, Unterlizenz- oder
kommerziellen Rechten bedarf einer gesonderten Vereinbarung durch den hierzu
Berechtigten; die jetzige Privatnutzungslizenz erteilt diese Rechte nicht
allgemein. Bestehende Rechte schließen unbelegte absolute Exklusivitätszusagen
aus. Namen, Logos und Domains sind gesondert aufzunehmen. Diese Übersicht
ändert keine Bedingungen historischer oder fremder Texte.
