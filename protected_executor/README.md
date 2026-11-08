# Bindungskern für geschützte Operationen

Unveröffentlichte Quellvorbereitung: **Kein Produktionshost, Geheimnistransfer,
geschützte Browsersitzung, neue API oder Dienst verfügbar.** Menschlicher Tresor,
Import, Autofill, Wiederherstellung, Kryptografie, LICENSE, AP4 und vorhandene
Downloads bleiben unberührt. FP-C02/FP-C03 bleiben produktiv offen. Dieser Schritt
härtet einen Baustein, keine Betriebssystemgrenze.


Die normale `ExecutorCore`-Verwendung scheitert ohne vorhandene unterstützte
Host-Capability mit `protected_host_unavailable`, **vor** jedem Grant-/Materialabruf.
Es gibt derzeit keinen Produktionshost. Ein öffentliches DTO, Boolean, Dictionary,
Claim `trusted=true`, gleichnamiges Objekt oder alter `grant_lookup`-Callback ist
kein Hostnachweis. Das Paket stellt keine Produktions-Capability aus.

Der einzige positive Testweg ist ausdrücklich
`SyntheticHostCapability.for_test(ProtectedGrant(...))`. Diese Fixture nimmt
**keine Geheimnisse, Dateien, Umgebungszugänge oder Materialcallbacks** an; der
verwendete Wert ist fest `synthetic-only-not-a-real-key`. Dieser öffentliche
Dummywert ist kein Anbieterzugang. Ergebnisse nennen `synthetic_test_only` und
`production_host_available=false`. Die nominelle Python-Typschranke schützt
**nicht** gegen einen gleichen UID mit unbeschränktem Shell-/Datei-/Debugzugang;
Python-Privatnamen oder ein zweiter Prozess wären keine Isolation.

### Vertrag und Lebensdauer

`contracts.py` enthält `4allpass-protected-use-v1` und
`4allpass-protected-grant-v1`. IDs/Referenzen sind begrenzte opake Zeichenketten,
keine URLs, Tokens oder Dateipfade. G-01 bleibt getrennt:
project/workflow/task/actor/consumer/attempt und Requesthash. Eine Sessionkennung
ersetzt keine Aufgabe und ein Hash authentisiert keinen Principal.

- `UseRequest`: G-01-Binding, grant_ref, grant_version, konfigurierte origin_ref
  und principal_ref sowie exakte Operation `demo.quota.read` und Zielalias
  `demo-quota-v1`. Keine freie URL/Methode/Headers/Body/Feldauswahl.
- `ProtectedGrant`: dieselben Bindungsfelder und konkreter request_hash;
  zusätzlich reference, consent_ref, issued_at, expires_at, lifecycle und Schema.
  **Kein Secret-/Material-/access_token-Feld.** Der alte experimentelle
  `Grant(secret=...)`-Konstruktor wird absichtlich nicht unterstützt; der
  Importname `Grant` verweist nur auf das neue Metadatenmodell.
- Die Inhalte des Requesthashs umfassen Version, Origin-/Principalreferenz,
  Operation/Ziel, Grantreferenz und alle G-01-IDs einschließlich Versuch und
  Consumer. Der Hash enthält nicht sich selbst. Eine nachträgliche Änderung
  dieser Felder braucht einen passenden neuen Hash **und** einen passenden
  vorhandenen Host-/Consentbeleg; Neuberechnen allein erteilt keine Freigabe.
- Version ist strikt int, kein bool/float/string, Bereich 1..2³¹−1. Zeiten sind
  endliche int/float-Werte, kein bool/string/NaN/±inf, begrenzter Epochbereich.
  Erst Typ-/Endlichkeitsprüfung, dann Ablaufvergleich. Lebensdauer >0 bis maximal
  86400s entspricht dem bestehenden oberen Access-TTL-Limit. Künftiges issued_at,
  abgelaufene Zeit sowie `revoked`/`expired` verweigern. Unbekannter Lifecycle
  verweigert. `active` ist eine Metadatenangabe, kein Nachweis menschlicher Zustimmung.
- Zu Beginn und nochmals **im tatsächlichen synchronen TollGate-Sendecallback**
  werden Requesthash, vollständiger Bindungsbezug, Version, Lifecycle und aktuelle
  Zeit geprüft. Ein inzwischen ausgetauschter Grant wird nicht verwendet.
  Wiederholter Callback sendet innerhalb desselben Aufrufs nicht doppelt.
- Der bestehende TollGate-Adapter reserviert und dispatcht weiter über denselben
  persistenten Auftrag/Versuch. Unklarer Ausgang bleibt unbekannt und wird nicht
  automatisch wiederholt; echte Kostenabrechnung ist davon getrennt.

Die Quelle einer späteren Produktionsfreigabe muss konfigurierte, authentisierte
Host-/Consentdaten außerhalb der Agentenkontrolle liefern und deren monotone
Versions-/Widerrufshistorie erhalten. Dieses Paket implementiert **keinen** zweiten
Grant-/Consentstore und keine neue Autorisierungsinstanz. Die aktuelle Fixture
enthält nur genau einen flüchtigen synthetischen Metadatensatz; ihre Referenzen
sind kein echter Origin-/Principalnachweis. Es gibt weiterhin keine tatsächlich
unzugängliche OS-/Secretgrenze, keinen vertrauenswürdigen Vaulttransfer und keinen
produktiven KB-Ursprungsnachweis. Deshalb kann der neue DTO-Vertrag allein keinen
Produktionslauf erlauben. Browser/DOM/Cookie-/Session-Schutz bleibt offen.

## Tatsächliche Teilprüfung

[Die Belege](../docs/evidence/protected-binding-20261018/STATUS.md) dokumentieren
gezielte Metadaten-/Host-Negativtests und vorhandene Tests des echten TollGate-
Adapters mit lokalem Testserver. Kein persönlicher Tresor, echte Zugangsdaten,
Anbieteraufruf oder bezahlte Anfrage. Breitere unveränderte Testsuiten wurden
lokal nicht wiederholt. Keine Builds, Releases oder Änderungen an Version,
Lizenz, Icon, Kryptografie, menschlicher UI oder Laufzeit.
