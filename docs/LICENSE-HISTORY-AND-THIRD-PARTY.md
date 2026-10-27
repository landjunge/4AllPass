# Lizenzhistorie und Drittbestandteile / License history and third-party scope

Geprüft / checked: 2026-10-27, Quellstand / source
`0b66a2fda7fcc831762e732eb20084137fa6029d`.
Diese Übersicht dokumentiert Belege und offene Auslieferungsprüfungen. Sie
erteilt keine neue Lizenz und bestätigt keine lückenlose Rechteinhaberschaft.
This index records evidence and remaining distribution checks; it grants no
new license and provides no ownership warranty.

## Aktueller Stand / Current terms

Die [LICENSE](../LICENSE) enthält die Netzwerkpunkt Personal Use License 1.0,
Copyright Daniel Filipek / landjunge, deutsche Fassung maßgeblich. Ihr §5 erhält
historische PolyForm-Rechte und andere bestehende Erlaubnisse. README, die neun
eigenen npm-Manifeste und deren Workspaceeinträge im npm-Lock stimmen damit
überein: `SEE LICENSE IN` verweist jeweils auf die Root-LICENSE. Cargo verwendet
`license-file = "../LICENSE"`, Tauri `LicenseRef-Netzwerkpunkt-Personal-Use-1.0`
und denselben `licenseFile`-Pfad. Diese Angaben benötigen keine Neulizenzierung.

The current custom source-available license, README, npm license-file references
and Cargo/Tauri metadata agree. Historical rights remain under section 5. The
license conditions and dependency locks were preserved.

## Belegte Historie / Evidenced history

| Grenze im heutigen main / Boundary in current main | Beleg / Evidence |
| --- | --- |
| Frühere Paketmetadaten / Earlier package metadata | Own core packages used `UNLICENSED`; other early manifests lacked a license field. This is not evidence of a general MIT grant. / Daraus folgt keine allgemeine MIT-Freigabe. |
| 2026-08-30 16:19:15 UTC | [`44ad4b2597b45405147e44426714d903c72725f1`](https://github.com/landjunge/4AllPass/commit/44ad4b2597b45405147e44426714d903c72725f1) introduces PolyForm Noncommercial 1.0.0 in main. Frontend/extension metadata follow in [`e32f2783cc1e30e9188e4d5160528fe8a3b9148a`](https://github.com/landjunge/4AllPass/commit/e32f2783cc1e30e9188e4d5160528fe8a3b9148a). |
| 2026-10-07 14:57:09 UTC | [`accb7a7e3ca8bc1596ddb74a5cb1ca160c38c01f`](https://github.com/landjunge/4AllPass/commit/accb7a7e3ca8bc1596ddb74a5cb1ca160c38c01f) introduces all-rights-reserved terms while preserving previous PolyForm rights. Its parent [`47cc823d36f7731001a83f7fbda87d38ccc8e9b4`](https://github.com/landjunge/4AllPass/blob/47cc823d36f7731001a83f7fbda87d38ccc8e9b4/LICENSE) retains the exact earlier license and Required Notice. |
| 2026-10-18 12:12:41 UTC | [`f184ade1443d344fc6c727e0833af8b601eb06f1`](https://github.com/landjunge/4AllPass/commit/f184ade1443d344fc6c727e0833af8b601eb06f1) adopts the current Personal Use License with existing permissions preserved in German and English. |
| Public release / Öffentlicher Release | [`v0.1.2-rc.2`](https://github.com/landjunge/4AllPass/releases/tag/v0.1.2-rc.2), built source `60eef0a7cc522c83dd13842c82c63a4430eb256f`, includes separate LICENSE and four third-party-notice archives. [Existing release evidence](LICENSE-RELEASE-20261018.md) distinguishes source, candidate and published packages. |

Commitdaten belegen Quelländerungen, nicht jeden Veröffentlichungszeitpunkt oder
Empfänger. Auch frühere Arbeitsbranchfassungen und einzelne verteilte Pakete
müssen nach den tatsächlich mitgegebenen Bedingungen beurteilt werden. Der
PolyForm-Text steht bereits in einem früheren Arbeitsbranch-Commit
`b54b9f7c2e7a2fdf9e768e8e392f8333f7433e34`; die Tabelle behauptet keine globale
erstmalige Veröffentlichung. PolyForm Noncommercial ist nicht mit der heutigen
engeren privaten Nutzung gleichzusetzen. Gültig eingeräumte historische Rechte
werden durch neue Commits oder einen späteren Verkauf nicht umgeschrieben.

Commit dates are source-history evidence, not a complete distribution record.
Historical copies retain their applicable grants and required notices. The
older PolyForm permitted-purpose provisions differ from current private-use
terms; they must not be narrowed by this index or a later sale.

## Fremdlizenzen und Notices / Third-party terms and notices

| Belegter Bereich / Evidenced scope | Erforderliche Prüfung / Distribution work |
| --- | --- |
| npm and Cargo locks | Resolve actual runtime/build/optional target inclusion. Preserve upstream license/copyright/NOTICE texts for redistributed components. A lock entry does not prove inclusion in every binary. / Ziel und tatsächliche Weitergabe bestimmen. |
| MPL-2.0 components | Cargo candidate metadata includes cssparser 0.36.0, cssparser-macros 0.6.1, dtoa-short 0.3.5, option-ext 0.2.0, selectors 0.36.1. npm includes lightningcss 1.33.0 as build tooling. Assess notice and source availability for distributed covered files; MPL does not automatically relicense every own file. [MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/). |
| Psycopg 3.2.4 | `backend/requirements.txt` declares `psycopg[binary]==3.2.4`; candidate notices identify psycopg/psycopg-binary under LGPL-3.0. Inspect final inclusion, upstream and bundled native notices, required source/replacement/relinking arrangements and EULA compatibility before distribution. [Upstream license](https://github.com/psycopg/psycopg/blob/3.2.4/LICENSE.txt). |
| PyInstaller packaging | Candidate metadata reports 6.22.2 with the commercial bundling exception. Packaging does not remove dependency obligations. Distinguish the tool's exception from licenses of bundled libraries. [Official terms](https://pyinstaller.org/en/stable/license.html). |
| r-efi | Candidate metadata offers `MIT OR Apache-2.0 OR LGPL-2.1-or-later`; record the permitted choice for an actually shipped component rather than treating all alternatives as cumulative. |
| SecLists blocklist | `backend/app/core/_account_password_blocklist.py` retains Daniel Miessler's MIT notice and upstream commit/hash. Preserve that notice; this is third-party data. |
| Optional Redis server | `deploy/compose.yml` declares floating `redis:7-alpine`. Record the actual version/digest and applicable server terms before delivery or hosting. The separately declared MIT redis-py client does not determine Redis Server's license. [Redis license matrix](https://redis.io/legal/licenses/). |
| Native/OS, containers and assets | Inspect actual GTK/GLib/WebKitGTK/WebView2/Apple runtime inclusion, container layers and their upstream terms. `brand/README.md` records asset provenance, not trademark clearance or a complete rights chain. |

Die vorhandene Sammlung durch `scripts/collect-release-notices.py` erfasst das
Buildumfeld einschließlich Buildwerkzeugen. Sie ist keine finale Runtime-SBOM.
Die vorhandenen RC3-Kandidateninventare erfassen 924–928 Komponenten; bei
53–57 Einträgen pro Ziel fehlt dort ein Notice-Text. Alle 1306–1312 bereits
referenzierten Dateien je Ziel wurden am Prüfdatum gefunden und ihre Hashes
bestätigt. Das schließt die verbleibenden Lücken nicht. Vor Auslieferung sind
fehlende Texte je tatsächlich enthaltenem Bestandteil zu klären, erforderliche
Sourcehinweise/-angebote bereitzustellen und native Ebenen zu ergänzen. RC3 ist
ein Kandidat und wird hier nicht als neuer veröffentlichter Release bezeichnet.

The existing candidate inventory covers the build environment, including
build-only packages. Missing notice texts remain unresolved; a successful hash
check of existing notices is not a complete compliance assessment. Prepare the
final per-target inventory and required upstream notices/source information for
the exact delivered build. Preserve historical packages and release notices.

## Vorbereitung einer Transaktion / Transaction preparation

Eigene wirtschaftliche Nutzungsrechte, frühere PolyForm-/Individualrechte und
Fremdrechte müssen getrennt in die Vertragsanlage. Beiträge, Arbeits-/Auftrags-
bezüge und KI-/Referenzherkunft sind anhand tatsächlicher Unterlagen zu prüfen.
Eine Käuferlizenz mit Bearbeitungs-, Übertragungs-, Unterlizenz- oder
kommerziellen Rechten bedarf einer gesonderten Vereinbarung durch den hierzu
Berechtigten; die jetzige Privatnutzungslizenz erteilt diese Rechte nicht
allgemein. Bestehende Rechte schließen unbelegte absolute Exklusivitätszusagen
aus. Namen, Logos und Domains sind gesondert aufzunehmen.

Separate evidence is required for the seller's own transferable rights,
historical grants and third-party components. Commercial, transfer, modification
and sublicensing rights for a buyer require the appropriate agreement and rights
chain. This index neither expands the current license nor promises exclusivity
over historical or third-party material.
