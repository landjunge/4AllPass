# 4AllPass-Dokumentation

**Status:** Verzeichnis, keine Spezifikation.

Neue Leser sollen diese Seite und fünf weiterführende Links benötigen, nicht zwanzig Dateien.

**19.10.2026 – aktueller Quellstand:** Maschinenzugriff bleibt ohne geschützten
Produktionshost gesperrt; kein Allow-/Rohgeheimnis-Demoweg.
Prüfweg: [Sperre prüfen](two-minute-demo.md),
[Grenze](security-boundary.md#7-machine-access-fail-closed).
Öffentliche Downloads `v0.1.2-rc.2` (`60eef0a`) enthalten weiterhin die historische
Übergabe. Integrierte Quellhärtung ab `a983814` aktualisiert keine installierten Kopien.

**Lebende Roadmap:** [../ROADMAP.md](../ROADMAP.md). Status dort pflegen.
Grok Build liest zuerst `grok-build-plan.md`, dann die Roadmap.

| Frage | Lesen |
| --- | --- |
| Was ist 4AllPass heute? | [../README.md](../README.md) |
| Wie ist der Tresor aufgebaut? | [architecture.md](architecture.md) |
| Wo liegt welche Oberfläche? | [ui-map.md](ui-map.md) |
| Optionaler UI-Durchgang mit Testtresor? | [UI_TEST_SUITE.md](UI_TEST_SUITE.md) |
| Was erzwingt die laufende Software? | [security-boundary.md](security-boundary.md) |
| Wie wird der Tresor gespeichert und synchronisiert? | [vault-protocol.md](vault-protocol.md), [vault-storage.md](vault-storage.md) |
| Wie sind Werkzeuge auf dem VPS getrennt? | [../deploy/LAYOUT.md](../deploy/LAYOUT.md) |
| Wie greifen Agenten heute auf Geheimnisse zu? | [security-boundary.md](security-boundary.md) §7, [local-access-broker.md](local-access-broker.md) |
| Wie sollen Agenten später auf Geheimnisse zugreifen? | [architecture/agent-access.md](architecture/agent-access.md), [secret-access-layer.md](secret-access-layer.md) |
| Was ist MAIP? | [specs/maip-v0.1.md](specs/maip-v0.1.md), experimenteller Entwurf, nicht implementiert |
| Was bauen wir als Nächstes? | [product-maturity.md](product-maturity.md) v3: Programmreihenfolge abgeschlossen; menschliche Restprüfungen fremder Mac, Apple, Audit. Später dort: eigener VPS als Cloud-Simulation, danach Mobilgerät am selben Tresor. |
| Was ist Vision statt implementiertem Code? | [architecture/future-architecture.md](architecture/future-architecture.md) |
| Wie sind Abhängigkeiten abgesichert? | [supply-chain-security.md](supply-chain-security.md): Pins, Herkunft, SBOM und Kryptografiekernregeln |
| Grok Build: Was zuerst? | [grok-build-plan.md](grok-build-plan.md), danach Lieferkettensicherheit, Codepflege, Phase 4 mit Geheimniszugriffsschicht |
| Bereit für den ersten echten Nutzer? | [future-readiness.md](future-readiness.md): Ausstieg, kryptografische Anpassbarkeit, Recht |
| Gesamtstatus und Roadmap? | [../ROADMAP.md](../ROADMAP.md) |
| Wie entstand das Projekt? | [entstehungslinie.md](entstehungslinie.md) |
| Wie ist die Positionierung? | [positioning.md](positioning.md), heutiger und ferner Zielstand |
| Wie treten wir auf GitHub auf? | [github-sichtbarkeit.md](github-sichtbarkeit.md) |
| Wie werden signierte Builds ausgeliefert? | [distribution.md](distribution.md) |
| Teammodus, noch nicht jetzt? | [team-mode.md](team-mode.md), Spezifikation und Roadmap |
| Postquanten? | [post-quantum-roadmap.md](post-quantum-roadmap.md) |
| Mobil zuerst PWA, später nativ? | [architecture.md](architecture.md) §5, [android-skeleton-grok-build.md](android-skeleton-grok-build.md), [ios-skeleton-grok-build.md](ios-skeleton-grok-build.md) |
| Codepflege: lib.rs, Pins, ps/lsof? | [architecture.md](architecture.md) §8, [../ROADMAP.md](../ROADMAP.md) §1b |

## Vorrang bei Widersprüchen

```text
security-boundary.md          what the running code enforces
        ↓
architecture.md               shape (client owns vault, server stores blobs)
        ↓
crypto-protocol.md
vault-protocol.md
vault-revision.md
recovery.md
ADRs
        ↓
product-maturity.md           product sequence (NOW)
architecture/future-architecture.md   vision (NOT a build license)
        ↓
README / site                 must not out-claim the docs above
```

Bei Widerspruch zweier Dokumente hat das höher eingeordnete Vorrang.
Bei Widerspruch einer Spezifikation zu `packages/crypto` haben Bibliothek und
Tests Vorrang.

Öffentliche Darstellung: **Lokal zuerst. Synchronisierung optional. Server deiner
Wahl. Kein verpflichtender Cloud-Dienst.** Die Desktop-Anwendung ist der Client;
Self-Hosting bezeichnet die Platzierung des Speichers. Diese Begriffe getrennt halten.

## Umgesetzt und später vorgesehen

Die Tabelle gibt den bisherigen Dokumentationsstand wieder; die deutsche
Sprachfassung führt keine neue technische Abnahme durch.

| Thema | Bisheriger Dokumentationsstand | Später; bei „weiter“ nicht ungeprüft umsetzen |
| --- | --- | --- |
| Tresorkryptografie | Client-AES-GCM, Hüllen | Unverändert |
| Desktop | Tauri und lokales SQLite | Derselbe Client, optionale entfernte URL |
| Selbst gehostetes FastAPI | Vorhanden, compose | URL-Feld im Client |
| Verwaltetes Hosting | Nicht angeboten | Gleiches Protokoll, anderer Endpunkt |
| Autofill | Chromium, Firefox und Safari-Wrapper | Später Shadow DOM und mehrstufige Abläufe |
| Agentenzugriff | Maschinenanfragen verweigert; kein geschützter Produktionshost; menschlicher Tresor/Autofill getrennt | Geschützte, ziel-/aufgabengebundene Nutzung nach bestätigter Host-/OS-Grenze |
| Agentenidentität | Nicht kryptografisch | [MAIP v0.1](specs/maip-v0.1.md), experimentell |
| Freigabe | Keine neue Rohgeheimnisübergabe; frühere TTL holt keine alte Kopie zurück | Reiner Metadatenkern vorhanden; Produktionshost-/Tresortransfer weiterhin nicht verfügbar |
| Mehrgerätesynchronisierung | Momentaufnahme-CAS, 409, Pin | Kein CRDT; bei 409 neu laden |
| Mobile Anwendungen | 0 %, zuerst PWA | Gleiches Tresorprotokoll; native Android-/iOS-Grundgerüste sind nur Vorbereitung |
| Teammodus | Nur Spezifikation | Kein PAM |
| Lieferkette | Lockdateien vorhanden; laut bisheriger Tabelle Audit/SBOM noch nicht in CI erzwungen | [supply-chain-security.md](supply-chain-security.md) |
| Codepflege | Module, gepinntes Cargo und `process_inspect`, 28.08.2026 | [architecture.md](architecture.md) §8, [../ROADMAP.md](../ROADMAP.md) §1b |

## Erhaltene Dokumente

Kryptografie- und Sicherheitsbelege bleiben erhalten: `crypto-protocol.md`
(Module unter `crypto/`), `vault-revision.md`, `webauthn-prf.md`, `recovery.md`,
`threat-model.md`, `adversarial-review*.md` (Module unter `reviews/`),
`audit-scope.md`, `test-vectors*`, `architecture/adr/`,
`supply-chain-security.md`, `future-readiness.md`, `grok-build-plan.md`,
`secret-access-layer.md`.

Ferne Konzepte bleiben jeweils eine Datei und als nicht implementiert markiert:
`team-mode.md` mit Roadmap, `capability-interface.md`, `secret-access-layer.md`,
`post-quantum-roadmap.md`.

**Regel:** Keine neuen Plan- oder Roadmap-Dateien. Ergänzungen erfolgen in
`../ROADMAP.md` oder der vorhandenen Spezifikation. Redundante Verweisdateien
wurden am 28.08.2026 entfernt.

## Aufräumstatus vom 28.08.2026

| Datei | Vorgang |
| --- | --- |
| `eight-week-agent-access.md` | Stub; Inhalt in `local-access-broker.md` und `secret-access-layer.md` |
| `plan-rest.md` | Stub; Status in `ROADMAP.md` §1/§5 |
| `roadmap.md` | Stub; lebende Roadmap ist `../ROADMAP.md` |
| `README-HUMAN.md` | Stub; Inhalt in `../README.md` |
| `positioning-target.md` | Stub; Inhalt in `positioning.md`, ferner Zielstand |
| `team-roadmap.md` | Stub; Inhalt in `team-mode.md`, Roadmap |

Diese sechs Dateien bleiben erhalten, damit alte Links weiter funktionieren.
Nicht neu verlinken und nicht weiter pflegen.
