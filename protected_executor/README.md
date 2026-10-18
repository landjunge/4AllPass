# Protected-operation binding core / Bindungskern

Unreleased source preparation; **no production host, secret transfer, protected browser
session, new API or service is available**. Human vault/import/autofill/recovery,
cryptography, LICENSE, AP4 and existing downloads are untouched. FP-C02/FP-C03
remain productively open. This slice hardens a building block, not an OS boundary.

## Deutsch

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

## English

Normal `ExecutorCore` calls fail with `protected_host_unavailable` before any
lookup when no supported host exists. There is no production host capability.
A DTO, boolean/dictionary, caller trust flag, duck-typed object or legacy material
callback cannot enable one. The sole positive path is an explicit
`SyntheticHostCapability.for_test` with a fixed public dummy value and metadata
only; no real material input, vault transfer, file, credential environment or
provider account is accepted. Output explicitly reports synthetic test scope and
production unavailable. Nominal Python types are **not** a same-UID/OS boundary.

The versioned request and metadata-only `ProtectedGrant` bind separate G-01
project/workflow/task/actor/consumer/attempt IDs, origin/principal references,
exact target/operation, grant version and concrete request hash. A consent
reference, issue/expiry times and lifecycle are required in the grant. No secret,
material or access-token field. A recalculated hash, actor label or `active`
claim grants no authority. The former experimental secret-bearing constructor
is intentionally unsupported.

Version is a strict positive bounded integer, not bool/float/string. Time values
must be finite numeric values before any expiry comparison; bool/string/NaN/inf,
invalid/future issue times, expiry, excessive lifetime and unknown/revoked/expired
lifecycle fail closed. Maximum lifetime follows the existing 86400-second upper
Access TTL limit. All binding, hash, version, lifecycle and current-time checks
repeat inside the actual synchronous TollGate dispatch callback. Changed grants
and duplicate callback invocations do not send again. Existing persistent
TollGate reservation/idempotency/stop/unknown handling is reused, not replaced by
a cached allow token or another queue.

Future real activation still requires an independently inaccessible executor,
trusted vault-to-host transfer, configured/authenticated origin/principal and
existing host/consent lifecycle history with monotonic versions. No such host,
store, account or deployment is created here. FP-C02/FP-C03 production and browser
session protection remain open. Matching synthetic metadata is not identity,
secret isolation, final cost settlement or user/project acceptance.

## Actual checks / Tatsächliche Teilprüfung

[Evidence](../docs/evidence/protected-binding-20261018/STATUS.md) records targeted
metadata/host-negative tests and the existing real TollGate adapter tests with a
loopback dummy server. No personal vault, real credential, provider call or paid
request. Existing broader unchanged suites are not locally repeated. No builds,
release, version, license, icon, crypto, human UI or runtime changes.
