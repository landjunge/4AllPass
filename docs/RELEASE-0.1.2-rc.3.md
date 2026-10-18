# 4AllPass 0.1.2-rc.3 — candidate / Kandidat

19 October 2026. Candidate source based on reviewed main
`7cc228d247883e1773a0adbd47a4a38dc8a963ec`. This file records preparation,
**not a completed build, release, platform acceptance or public download**.
The actual immutable candidate commit is recorded by each CI `source-*.json`
and the assembled release manifest; a merge commit must not replace that pin.

## Deutsch

**Absichtliche Verhaltensänderung gegenüber RC2:** Maschinenzugriff über den
alten Agenten-/Brokerweg ist gesperrt, auch nach einer früheren Allow-Antwort.
Die alte Rückgabe kopierte das tatsächliche Geheimnis als `access_token`.
Eine Nutzungserlaubnis ist keine Erlaubnis, dieses Material an eine KI zu geben.
Vorhandene n8n-/Agentenabläufe, die diesen Weg benötigen, erhalten eine Ablehnung.
Kein Ausweichen auf Rohgeheimnis oder Umgebungsdatei im Modell-Arbeitsbereich.

Ein geschützter Produktionshost, vertrauenswürdiger Vaulttransfer und geschützte
Browseranmeldung sind weiterhin **nicht verfügbar**. Der getestete synthetische
API-Kern ist keine produktive Zugangsnutzung, OS-Isolation oder Kostenfreigabe.
TTL holt alte Kopien oder Anbieter-Sitzungen nicht zurück. Menschlicher Tresor,
Importreview, Autofill, Recovery und Kryptografie bleiben separate bestehende Wege.

Der Paketcheck verlangt erstmals am tatsächlich gestarteten Sidecar acht feste
Fälle: ausgelassen/raw_secret/mediated → ausschließlich handoff_unavailable;
fehlender/falscher Token und fremde/null/lokale Browser-Origin → bestehende
401/403-Ablehnung. Nur synthetische temporäre Daten, minimale Prozessumgebung,
kein geerbter Nutzer-Token oder Projekt-`.env`. Alte Health-only-Belege reichen
nicht. Neue Plattformbelege müssen `packaged_machine_handoff_deny_v1=true` und
alle acht Prüfkennungen enthalten.

Gemeinsame Netzwerkpunkt-Bedienbasis und die freigegebenen AP4-Originale bleiben
erhalten. LICENSE ist unverändert die Netzwerkpunkt Personal Use License1.0:
private nicht geschäftliche Nutzung kostenlos; geschäftliche Nutzung nur mit
gesonderter schriftlicher Erlaubnis. Deutsch maßgeblich, englische Übersetzung;
individuelle Vorlage, kein OSI-Standard und keine anwaltliche Prüfung.
Fremdlizenzen und historische Rechte bleiben bestehen.

Geplante vorhandene Buildziele: macOS/Intel-macOS/Windows/Linux im bestehenden
manuellen Desktop-Workflow. Verfügbar ist später ausschließlich, was wirklich
gebaut und anhand Architektur/Quellpin/Lizenz/AP4/Start-/Deny-Belegen geprüft ist.
Ohne vorhandene Zertifikate bleiben macOS ad-hoc/nicht notarisiert und Windows
unsigniert. Keine neue vollständige native GUI-/Import-/Autofill-/Recovery-Abnahme,
kein fremder Mac, kein unabhängiges Drittaudit und keine allgemeinen Rechts- oder
Sicherheitsgarantien aus Paketprüfungen ableiten.

RC2 und `desktop` bleiben mit ihren alten Tags, Bytes, Signaturen und Hashes
unverändert. Dieser Kandidat schreibt nichts rückwirkend um. Download- und
Installerziele wechseln erst nach vollständiger verifizierter Veröffentlichung.
Bestehende Tresordaten werden nicht migriert, gelöscht oder zurückgesetzt.

## English

**Intentional behavior change from RC2:** machine credential handoffs through
the legacy broker/agent path are denied, including stale Allow responses. The
old `access_token` was a copy of actual vault material, not a minted scoped
provider token. Existing n8n/agent workflows that require this route will fail
closed. Do not work around it by putting raw credentials into model workspaces.

There is still **no production protected executor, trusted vault transfer or
protected browser-login service**. Synthetic API-core tests do not prove real
secret use, OS isolation, identity, cost authorization or project acceptance.
TTL cannot recall previously issued copies/provider sessions. Human vault,
import review, autofill, recovery and cryptography remain separate existing paths.

The built-sidecar checker now requires eight real bounded denial requests, with
synthetic temporary data and no inherited user token or project `.env`. Old
health/UI-only startup evidence cannot satisfy the new machine-denial marker.
Each actually built platform needs source/version/architecture, current LICENSE,
AP4, startup and eight-case denial evidence plus fresh SHA256 checksums.

The adopted Netzwerkpunkt Personal Use License1.0 and approved AP4 sources are
unchanged. German governs; English is a translation. Private non-business use is
free; business use requires separate written permission. Custom source-available
terms, not an OSI license or legal review. Third-party/historical rights remain.

Only actually built and checked platforms may be offered. Without existing
certificates macOS remains ad-hoc/not notarized and Windows unsigned. No complete
native GUI/import/autofill/recovery, stranger-Mac or third-party-audit acceptance
is claimed. Historical RC2/desktop assets and installer defaults are not changed
by preparing this source. Publication and coherent download-target updates are
separate verified steps, owned by the coordinator.
