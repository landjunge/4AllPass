# 4AllPass – Roadmap (lebende Datei)

> **Status:** aktiv. Das ist die **eine** Roadmap-Datei. Keine neuen Spezial-Pläne anlegen – hier rein, Status updaten, fertig.
> Maßgeblich für implementierte Zusicherungen: `docs/security-boundary.md`.
> Grok Build liest danach diese Roadmap und `docs/grok-build-plan.md`.

## Gesamtauftrag E01–E09, 20. Oktober 2026

Der ausdrücklich beauftragte Gesamtplan führt diese Roadmap fort; ältere
Reihenfolgen unten sind historische Teilpläne. Keine zweite Roadmap anlegen.
Original: ThreadDesk `6b5b73b9de36`, Revision 3,
„Gesamtplan ThreadDesk & 4AllPass – 20.10.2026“, zehn geordnete Anlagen,
107935 UTF-8-Bytes, SHA256
`4b8ac493add0b76bd1a353d59d13152bbb5ec62bc956c1def9f1ccc1aa211ca8`.
Vollständige Fach-API-Nachlese bestätigt. Codex koordiniert abgegrenzte native
Teamaufgaben. Groks abgeschlossene E02- und IndexedDB-Abnahmen bleiben gültig;
nach Daniels ausdrücklichem Kontingenthinweis arbeiten und prüfen getrennte
native Codex-Agenten ohne weitere Grok-Aufträge. Codex nutzt drei klar abgegrenzte native Unteragenten;
Grok hat AP01/AP02 authentisiert angenommen und zwei native Review-Unteragenten
gestartet. Seine eigene unabhängige Prüfung gibt beide Quellumfänge frei;
die zusätzlichen Teamresultate werden nachgereicht. Die bereits
übernommene Bridge-Nachricht `7a7a268e-09c2-4a0f-a333-031cd7fc094c` erzeugt
keinen zweiten Gesamtauftrag. Handy-/öffentlicher Tunnelzugang bleibt zurückgestellt.

| Etappe | Zugeordneter Umfang | Aktueller Stand / nächster Nachweis |
| --- | --- | --- |
| E01 | P00/R01, RC9/RC10 und ST-01–ST-05 | Aktuelle Hauptstände, vorhandene Belege und isolierte Umgebungen erfasst. Bridge-Reparatur abgeschlossen: Code `956b0f8`, Architektur `41f4b89`, installierter Quellpin `cfad2a30…ceb7`. Vorhandener echter Kira→Codex→Kira-Test einschließlich getrenntem Einfügen/Return und beider authentisierten ACKs übernommen; Originaltest nicht wiederholt. Beleg: KiraBridge `docs/evidence/receiver-resilience-mac-20261020.json`. |
| E02.1–2 | ThreadDesk TD-01/TD-02 | Im Quellumfang abgeschlossen: PR #78/#79 auf main `88a5b4d`, Grok ship, native CI grün. Echte WKWebView-Abnahme JSON8/8 + SQLite8/8; tatsächlicher Zweitgeräte-LAN-Client fehlt. Paket/Installation gesondert, siehe ThreadDesk `docs/TEAMPLAN.md`. |
| E02.3 / AP-01 | Aktive Anweisungen und offene Arbeit | Abgeschlossen im Dokumentumfang: PR #229 (`ab1aba3`) als `7a9416d` auf main integriert, CI grün. Grok `ship`, Ergebnis `9784c6e6-3258-42ad-8295-a30ea114ee27`. Aktive Anweisungen entsprechen Machine-DENY; #217-Zielversionen bereits auf main, #216 nicht pauschal übernommen. |
| E02.4 / AP-02 | Überlanger stockender Stream F4 | Im Quellumfang abgeschlossen: PR #230 als `262917f`, Grok ship mit eigenem 11/11-Lauf, PR- und Main-CI grün. SQLite156+1 Postgres-Skip und echter Postgres157. Keine neue Paket-/Installationsbehauptung. |
| E03 | P01–P05, R02–R07/R12, AP-04 | IndexedDB PR #231 als `45331a3`, H1 PR #232 als `f547b3b` und R05 PR #233 als `a65ab12` integriert; unabhängige Abnahmen und PR-/main-Prüfungen grün. Pin-content PR #235 als `3715120` integriert, unabhängiges Codex ship mit 15/15 Zieltests, PR-Prüfungen grün; main-Prüfungen laufen. AP04, übrige Krypto-, Recovery- und Betriebsabnahmen bleiben gesondert offen. |
| E04 | P06–P08/P11–P12, R08–R11/R15–R17, AP-03 | Offen: normale Browser-/Desktopwege und tatsächlich geprüfte neue Pakete; Hardware-/Fremdmac-/Signierungsnachweise getrennt. |
| E05 | UI-01 | Vorbereitender Pollstatus-Slice PR #234 unabhängig geprüft: 213 Frontend-Tests, 11 Zieltests und DE/EN-Komponenten 8/8; Rebase behält diese Produktbytes bei, frische CI folgt. Offen: bestehendes KiraBridge-Icon, gemeinsame kompakte App-Leiste und frische bestätigte Status-/Openadapter; nur bestätigter 4AllPass-Unlock pulsiert sehr dezent. |
| E06 | TD-03–TD-06/TD-08 mit AP-04 | Offen: bestätigte Personen/Geräte, Projektrollen, atomarer Transfer, Sync und gebundene Agentenaufträge. |
| E07 | AP-05–AP-07, P09/R13–R14 | Offen: begrenzte Grants, echte Host-/Vaulttransfer-/Ursprungsgrenze und eine freigegebene reale Anbieteroperation mit bestehendem TollGate-Adapter. |
| E08 | TD-07 | Offen: berechtigte Inhaltssuche und separater optionaler Bridge-Dateiindex mit Messung. |
| E09 | AP-08/TD-09, P10–P12, R01–R17/H1–H6/T01–T22 | Offen: einschlägige Nachweise, Nutzerwege, Paketherkunft, Installation/Update/Recovery und benannte Grenzen. |

Pro Unterpunkt werden Commit, Dateien, konkrete Tests und das unabhängige Prüfurteil,
verbleibende Grenzen und nächster Schritt ergänzt. Übergabe, Implementierung,
Prüfung, Aktivierung und Produktfreigabe bleiben getrennt. Historische RC3-Belege
werden nicht neuen Paketbytes zugerechnet; öffentliche RC2-Downloads bleiben
unverändert. Restrolle beim Transfer, Manager-/Abnahmerechte, Stellvertretung
und Executor-Betriebsprofil/erste Operation benötigen vor ihrem jeweiligen
Ausbau eine fachliche Entscheidung; lokale Reparaturen laufen unabhängig weiter.

---

## E02 / AP-02 – gestoppte übergroße Uploads (20.10.2026)

Der beauftragte Gesamtplan liegt vollständig in ThreadDesk, Thread `6b5b73b9de36`.
AP-02 ist als kleiner Quellcode-Kandidat umgesetzt: Nach Überschreiten des
Body-Limits folgt sofort HTTP 413, ohne auf den restlichen Upload zu warten.
Der isolierte echte HTTP/1-Test lässt den Upload absichtlich unvollständig;
Antwort und Verbindungsende treffen innerhalb von zwei Sekunden ein.

Gezielte Body-Tests und Backend-CI sind grün: SQLite 156 bestanden und ein
Postgres-spezifischer Migrationstest übersprungen; der getrennte echte
Postgres-CI-Lauf besteht mit 157 Tests (Run `39408953555`). Grok prüfte den
Quellpin `3951697` unabhängig: `ship`, eigener isolierter Body-Lauf 11/11 in
0,37 Sekunden; authentisiertes Ergebnis `9784c6e6-3258-42ad-8295-a30ea114ee27`.
Die Laufzeitdateien bleiben beim Neuaufsetzen auf AP01-main bytegleich.
Neue CI für den integrierbaren PR-Stand folgt. Installierte Pakete sind
dadurch nicht geändert; ihre Abnahme gehört weiterhin zu AP-03/E04.

## E03 / P02 und P04 – lokale IndexedDB-Abschlüsse (20.10.2026)

Ein erfolgreicher IndexedDB-Request konnte bisher vor dem Transaktionsabschluss
Erfolg melden, selbst wenn anschließend ein Abort das Schreiben oder Entfernen
zurückrollte. Beide bestehenden Storehelfer warten jetzt auf `oncomplete` und
weisen `onabort`/Fehler zurück. Snapshotcache und Device-Unlock-Record behalten
getrennte lokale Helfer; weder Krypto noch Schlüssel-/Geräteverträge ändern sich.

Unveränderte Basis `262917f`: Die gezielten privaten Ereignisproben hatten
30 Fehler bei 39 Fällen; mit der Korrektur bestanden 39/39. Die echte isolierte
Chrome-IndexedDB-Probe prüft beide Stores mit save/load/remove und Commit/Abort:
12/12 mit Korrektur, 0/12 für den bisherigen Abschlussvertrag. Sie verwendet
synthetische Records und frische Browserkontexte, keine Authenticator-Ceremony.
Wiederholbar: `node scripts/verify-indexeddb-transactions.mjs [Quellcommit]`.
Frontend 202/202, WebAuthn 44/44 und beide Workspace-Typechecks bestanden;
gezielte Ereignisproben 39/39. Beleg: [Persistenzprüfung](docs/evidence/indexeddb-transactions-20261020/STATUS.md).
Groks unabhängiges Commitreview, Integration und Paketabnahme stehen aus. E03 ist nicht insgesamt
abgeschlossen. Online-Cache bleibt best-effort; Eviction, Disk-/Stromausfall
sind dadurch nicht ausgeschlossen.

## E03 / R05 – genaue WebAuthn-Origin und Ceremony-Kontext (20.10.2026)

Der Software-COSE-Gegenversuch am Ausgangsstand `262917f` belegt zwei getrennte
Policyfehler: Teilstring-Ersetzung erzeugt eine nicht konfigurierte Domain;
`crossOrigin`/`topOrigin` werden nicht gemäß dem unterstützten Kontext geprüft.
Die Korrektur begrenzt Loopback-Aliase auf tatsächliche Hostnamen und lokale
bzw. Entwicklungsprofile. Fremde eingebettete Kontexte werden abgewiesen,
gleiche Origin mit gültiger Signatur bleibt unterstützt. Vertrag:
`docs/webauthn-prf.md` §2.5. Ein unabhängiger nativer Codex-Agent prüfte den
Quellstand mit `ship-with-nits`; die kleinen Nachbefunde sind korrigiert
(49 gezielte Prüfungen grün). Daniel hat nach Ausschöpfen des Grok-Kontingents
die Fortsetzung ohne Grok angewiesen. Frische CI und Integration folgen;
kein Paket, keine Hardwareceremony und kein produktiver AP04-Gerätevertrag
werden dadurch als abgeschlossen geführt.

## E05 / UI-01 – Voraussetzung: ehrlicher vorhandener Pollstatus (20.10.2026)

Der bisherige optionale Brokerclient meldete live vor der ersten Antwort,
behandelte einen HTTP 500 mit passendem Body als Nachricht und lieferte bereits
laufend gelesene Antworten auch nach Trennen/Neuverbinden. Dieser getrennte
kleine Schnitt korrigiert diese Zustandsübergänge; der unabhängige Codex-Review
fand zusätzlich einen synchronen Disconnect im Statuscallback, ebenfalls
korrigiert und nachgeprüft. Gegenprobe alt: fünf Fehler, vier bestanden; neue gezielte Prüfung 11/11,
bestehende Komponenten in frischem Chrome DE/EN 8/8 ohne Seitenfehler.
Das ist keine fertige App-Leiste. Assetzuordnung KiraBridge, enger Open/Fokus-
Adapter und authentisierter frischer Peer-/User-/Vaultstatus bleiben offen;
dieser Pollstatus darf Ring/Unlockpuls nicht begründen. Beleg:
`docs/evidence/broker-connection-state-20261020/STATUS.md`.

## 0. Sofort (Grok Build, kein Warten)

1. **Supply-Chain** – Phasen 1–3 auf `main` (2026-08-28). Pinning, CI-Audits, Crypto-Allowlist, SBOM. Private Registry bleibt offen.
2. **Code-Hygiene** – completed 2026-08-28. Nicht mehr in der offenen Reihenfolge.
3. **Secret Access Layer, datierter Teilplan** – A+B im Code: `detectSetup` fragt, Extension füllt nur nach Klick. Aktueller Maschinenweg verweigert Materialübergaben, auch nach Allow; kein raw-secret-Fallback. Synthetischer Protected-Executor ist kein produktiver Host. Weiterer Ausbau nur im zugeordneten E03/E07-Umfang nach `docs/security-boundary.md` §7.
4. **Mobile** – **PWA zuerst**, dann native. Android-Skelett (`docs/android-skeleton-grok-build.md`) und iOS-Skelett (`docs/ios-skeleton-grok-build.md`) sind nur Prompt-Vorlagen – **kein** Freifahrtschein, native Apps vor der PWA zu bauen. Reihenfolge: PWA → Android → iOS.

**Später (nicht jetzt):** MAIP-Implementierung – kryptografische Agent-Identität, Enrollment, signierte Requests, Revocation. Spec: `docs/specs/maip-v0.1.md` (Experimental Draft). `docs/architecture/agent-access.md` bleibt Proposed.

**Headless / Roboter:** Library-Prototyp 2026-08-30 (`packages/crypto` requester signatures, `@4allpass/core` `riskClass` + `decideStandingAccess`). Er aktiviert keinen Sidecar-Zugriff: aktuelle Python-/Node-Broker und der Client verweigern maschinelles Material. Kein Geräte-Protokoll. Vault-Device-Envelopes sind **nicht** Agent-Identität. Spec: `docs/architecture/agent-access.md` § Headless.

---

## 0b. Zuerst der Mensch (kein KI-Token)

Sortierung: **(1)** kannst du es sofort allein tun (kein Login-Warten bei einer KI) **und (2)** reduziert es echtes Risiko oder eine Abhängigkeit. Was **beide** erfüllt, kommt zuerst.

| # | Was | Status | Risiko / Abhängigkeit |
|---|---|---|---|
| 1 | `@4allpass` auf [npmjs.com](https://www.npmjs.com) als Org/Scope anlegen | ☐ **du** — diese Maschine ist nicht `npm`-eingeloggt; Registry ist 404 | F-26 Medium. Dependency confusion, dauerhaft. 5 Minuten. |
| 2 | Node-Dev-Broker: `!==` → `timingSafeEqual` | ☑ auf `main` | F-28. `tokenMatches` in `packages/broker/src/relay.mjs` (Längen-Check, dann `timingSafeEqual`). **Nicht nochmal bauen.** |
| 3 | `docs/adversarial-review.md` und `.grok/skills/4allpass/SKILL.md` (Kopie: `.claude/skills/…`; nicht `.cursor/`) **selbst** lesen | ☐ du | Unabhängig von einer KI-Zusammenfassung. Recovery/Rollback sind in F-29 und `adversarial-recovery.test.ts` schon angegriffen. |
| 4 | `npm run test:crypto:heavy` und `cd backend && pytest` lokal **anschauen**, nicht nur glauben | ☐ du | Grün selbst sehen. |
| 5 | Standing / Aktuation **selbst entscheiden und aufschreiben**, bevor Sidecar verdrahtet wird | ☐ du | Ort: `docs/architecture/agent-access.md` § Maintainer. Keine KI rät „auch nachts?“. |

**Jetzt (15 Minuten, ohne KI):** Punkt 1. Punkt 2 ist erledigt.

### npm-Scope (Punkt 1)

Live-Check 2026-08-30: `GET https://registry.npmjs.org/@4allpass/crypto` → 404. `npm whoami` auf diesem Mac → nicht eingeloggt. Eine KI kann die Org nicht anlegen.

1. `npm adduser` (Account, der `landjunge` gehört).
2. Organisation **4allpass** anlegen: [npmjs.com/org/create](https://www.npmjs.com/org/create) → Scope `@4allpass`.
3. Leere **Platzhalter** publizieren (`access`, `broker`, `core`, `crypto`, `providers`, `webauthn`) — **nicht** den Vault-Code. Nur den Namen besetzen.
4. Lockfile bleibt `"link": true`. `npm ci` im Repo zieht intern, nicht von npmjs.
5. Dann hier und in `docs/supply-chain-security.md` §6 ☑ mit Datum.

`workspace:*` ist **kein** Ersatz (#155, CI `EUNSUPPORTEDPROTOCOL`).

---

## 1. Produkt-Reihenfolge (NOW)

Quelle der Wahrheit für Code-Prioritäten: `docs/product-maturity.md` (v3).

```text
P0/P1 implementation substantially complete
 → external usability validation (Fremder Mac, #120)
 → remaining edge cases only after evidence
     P2  Agent UX — Code existiert, nicht First Screen
     P3  Passkeys / OTP — TOTP auf main; Passkey-Store später
```

Autofill V1 nicht weiter auf Verdacht ausbauen. Spec bleibt `docs/autofill-v1.md`.

**Konkrete nächste Schritte (Code vor Docs):**

1. **Tresor** – Vault anlegen, Passwörter rein, speichern, wieder abrufen. Der Kern, den jeder Nutzer als Erstes testet.
2. **Broker (Loopback)** – bestehendes Machine-DENY erhalten. Historisches Allow/TTL ist kein freigegebener Materialkanal; geschützte Ausführung benötigt E07-Nachweise.
3. **PWA** – Login, Homescreen-Icon, offline-fähig. Kein App Store, kein Review.
4. **Schauen, was fehlt** – erst dann entscheiden, ob Autofill / native Apps überhaupt noch nötig sind.

| Baustein | Status |
|---|---|
| Tresor, Crypto, Hard-Revoke, CAS | auf `main` – nicht anfassen |
| Desktop (Tauri) | auf `main` |
| Extension Chromium + Firefox + Safari-Wrapper | auf `main` |
| Access-Policy und Broker | auf `main`; Maschinenmaterial wird verweigert, kein produktiver Executor |
| Apple-Notarisierung | pausiert (~99 USD/Jahr) |
| Unabhängiges Dritt-Audit | offen (#38) |
| Fremder-Mac-Test | offen (#120, übersprungen) |

---

## 1b. Code-Hygiene — completed 2026-08-28

> Quelle: Code-Review 2026-08-28. Erledigt. Nicht neu erfinden.

1. **`src-tauri/src/lib.rs` aufteilen** – Prozess-Management, Sleep-Detection, Access-Prompts, Tray, HTTP-Proxy in eigene Module.
2. **`Cargo.toml` streng pinnen** – exakte Versionen statt `"2"`.
3. **`ps`- / `lsof`-Aufrufe abstrahieren** – Plattform-Schicht (`process_inspect.rs`).

| Punkt | Status |
|---|---|
| `lib.rs` Modularisierung | ☑ 2026-08-28 | process, loopback, sleep, prompts, tray, sidecar_http |
| `Cargo.toml` Pinning | ☑ 2026-08-28 | `=x.y.z` + `cargo fetch --locked` in CI |
| Plattform-Abstraktion (ps/lsof) | ☑ 2026-08-28 | `process_inspect.rs`: `/proc` + lsof/ps, Windows netstat |

---

## 2. Grok-Build-Pläne (ausführbar)

| Plan | Datei | Status |
|---|---|---|
| Supply-Chain | `docs/supply-chain-security.md` | Phasen 1–3 auf `main` 2026-08-28. Private Registry bleibt offen. |
| Code-Hygiene | dieses Dokument §1b | ☑ 2026-08-28 |
| Secret Access Layer (vorbereiten) | `docs/secret-access-layer.md` | A+B detect/ask 2026-08-28; mediated/policy; MAIP später |
| Android-Skelett | `docs/android-skeleton-grok-build.md` | bereit (Prep, nicht vor PWA) |
| iOS-Skelett | `docs/ios-skeleton-grok-build.md` | bereit (Prep, nicht vor PWA) |
| Future Readiness | `docs/future-readiness.md` | offen |

**Reihenfolge:** Supply-Chain (done) → Code-Hygiene (done) → Secret Access Layer vorbereiten → Mobile (PWA → Android → iOS). MAIP nicht in dieser Sequenz.

---

## 3. Future Readiness (vor dem ersten Nutzer)

Quelle: `docs/future-readiness.md`.

| Punkt | Status |
|---|---|
| Exit-Strategie / Export-Format | ☐ offen |
| Exit-Strategie / Import-Anleitung | ☐ offen |
| Crypto-Agility / KDF-Migration | ☐ offen |
| Crypto-Agility / AEAD-Migration | ☐ offen |
| Rechtliches / Impressum + Datenschutz | ☐ prüfen |
| Rechtliches / DSGVO-Antworten | ☐ offen |
| Rechtliches / Support-Kanal | ☐ offen |

Empfohlene Reihenfolge: Exit → Rechtliches → Crypto-Agility.

---

## 4. Bewusst nicht (bis explizite Entscheidung)

- Team Mode, **MAIP-Implementierung** (Identität ≠ Vorbereitung der Access-Schicht), Managed Hosting, S3/WebDAV-Picker
- **Roboter / MHS / Policy-Freigabe** — parked in `docs/architecture/agent-access.md`. Kein paralleles Robotik-Produkt. Kein always-allow solange `application` ein String ist. Device-Envelopes nicht als Agent-Ausweis.
- Shadow DOM / Multi-Step / iframe (nach stabilem Password-Autofill)
- Passkey-Store, Launch-Posts, Connection/Capability-UI
- Kein Core-Rewrite, kein zweites Tauri, kein zweites Crypto
- **Keine nativen Mobile-Apps vor der PWA** (Skelette sind nur Vorbereitung)

Vision (nicht implementieren): `docs/architecture/future-architecture.md`.

---

## 5. Offene menschliche Checks

0. **`@4allpass` npm-Scope** — §0b Punkt 1. Einziger offener Medium-Fund (F-26), den Code allein nicht schließt.
1. [#120](https://github.com/landjunge/4AllPass/issues/120) – Fremder Mac: App auf, Tresor, Browser-Karten.
2. [#112](https://github.com/landjunge/4AllPass/issues/112) – Apple ~99 USD/Jahr für Doppelklick / `v0.1.2`.
3. [#38](https://github.com/landjunge/4AllPass/issues/38) – Unabhängiges Dritt-Audit.
4. §0b Punkte 3–5 (Docs selbst lesen, Tests selbst sehen, Aktuation aufschreiben).

---

*Zuletzt aktualisiert: 2026-08-30. Lebende Datei – Status hier pflegen, keine Parallel-Pläne.*
