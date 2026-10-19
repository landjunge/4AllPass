# FP-R01 / FP-V01 — documentation and existing RC3 artifact review

19 October 2026 (Europe/Berlin). Continuation of
`seven-tools-build-20261018-1833`. Documentation base:
`3ee541a9a01c5b9cfc75e00b43e90f3a41b0d93f` (merged PR226).

## Deutsch

Der widersprüchliche Absatz in der [Security Boundary](../../security-boundary.md)
behauptete weiterhin, es gebe keine Oberfläche für frühere Stände und nur einen
manuellen Datenbank-Rückweg. Der bestehende Code bietet zwei getrennte Wege:

- Im entsperrten Tresor zeigt **Einstellungen → Sicherheit → Frühere Stände**
  Titel/Benutzer eines lesbaren früheren Standes. Wiederherstellen schreibt einen
  neuen Stand; ein anderer Vault Key lässt sich damit nicht ersetzen.
- Nach einem fehlgeschlagenen Masterpasswort-Unlock kann die Person ausdrücklich
  nach einem intakten früheren Stand suchen und dessen Übernahme bestätigen.
  Dafür wird dessen eigenes Master-Envelope verwendet; ein entsperrter aktueller
  Tresor ist keine Voraussetzung. Account-/Eigentümerzugriff, ein vorhandener
  mit diesem Passwort entschlüsselbarer Stand und ein akzeptierter Vorwärtscommit
  bleiben erforderlich. Fehlende Daten/Schlüssel, eine höhere Schlüsselversion
  am aktuellen Head oder ein CAS-Konflikt können die Wiederherstellung verhindern.

Ein gestohlener Accountzugang kann weiterhin schädliche, syntaktisch gültige
Snapshots schreiben. Die Korrektur behauptet weder VK-authentisierte Writes noch
eine allgemeine Verfügbarkeits- oder Wiederherstellungsgarantie. Nur die beiden
falschen History-/DB-only-Aussagen wurden an vorhandenen Code angeglichen.
Zusätzlich nennt die bestehende Unlock-Oberfläche nach erfolgloser Suche jetzt
die möglichen Passwort-, History- und Verbindungsursachen. Ein Null-Ergebnis oder
abgefangener Suchfehler beweist kein falsches Passwort. Nur DE/EN-Text geändert;
Such-, Fehler-, Schlüssel- und Wiederherstellungslogik bleiben unverändert.

Die [minimierte JSON-Quittung](artifact-review.json) prüft die **bereits gebauten**
vier RC3-Artefakte aus [Build 39175745620](https://github.com/landjunge/4AllPass/actions/runs/39175745620).
Gebauter Pin bleibt `16ca6b91aced4121f55bb08b57c934bd612da3d3`, Version 0.1.2-rc.3;
der spätere Merge-/Dokumentationsstand ist kein neuer Binarypin. Archivdigests und
Installer-SHA256 wurden unabhängig abgeglichen; alle Quell-/Vorabstart-/Paketbelege
tragen denselben Pin, die aktuelle LICENSE und acht tatsächliche CI-Deny-Fälle.
Diese Requests wurden lokal nicht wiederholt. Beide DMGs wurden zusätzlich nur
lesend geprüft: arm64/x86_64, Bundleversion, strikte Codesignprüfung, LICENSE,
native AP4-Datei und beide Erweiterungsicons. Linux-ELF wurde ohne Start gelesen.
Windows-Payloadarchitektur sowie Windows-/Linux-Innenressourcen stützen sich auf
die quellgebundenen CI-Prüfungen; sie wurden auf diesem Mac nicht neu ausgeführt.

Kein neuer Build, Release, Tag, Downloadwechsel oder produktiver Lauf. Öffentliches
RC2 bleibt der historische 60eef0a-Stand mit altem Rohmaterialkanal. macOS ist
ad-hoc signiert, Windows `NotSigned`; keine neue Notarisierung, Fremd-Mac-, native
Vollabnahme oder Drittaudit. FP-C02/C03 benötigen weiterhin echte OS-/Secret-/
Browserisolation, vertrauenswürdigen Vaulttransfer und eine konkrete erlaubte
Aktion. Ein zweiter Prozess unter derselben UID erfüllt diese Voraussetzung nicht.

## English

The boundary now matches existing history and damaged-head recovery paths. The
unlocked settings panel is distinct from the explicit master-password search and
confirmation offered after failed unlock. Recovery still needs authorized access,
an available decryptable older snapshot and an accepted forward commit. Missing
keys/history, head key-version increases and concurrent writes can prevent it;
token-authorized denial of service remains possible. No cryptographic behavior
or write-admission rule changed and no general recovery guarantee is claimed.
The existing failed-search message no longer diagnoses a wrong password from a
null result or caught lookup failure: DE/EN copy names password, missing/unreadable
history and connection problems as possible causes. No control flow changed.

All four **existing** RC3 archives and installer hashes match source-bound
preflight/package evidence for 16ca6b9. Eight actual CI denial records per platform
were inspected, not rerun locally. Both macOS images additionally passed read-only
architecture/signature/LICENSE/AP4 inspection; Linux ELF architecture was read.
Windows payload/resource and Linux inner-resource checks remain CI evidence,
clearly separated from local inspection. No candidate application or packaged
sidecar ran locally.
This is candidate review, not publication, installed-copy updates, notarization,
stranger-Mac testing, independent audit or user acceptance. Historical RC2 and its
download targets remain unchanged.

Documentation validation passed: all 17 local links in this record resolve,
the minimized JSON agrees with the review source and four-platform/eight-case
invariants, `python3.11 scripts/check-release-license.py` passes with unchanged
LICENSE SHA256 `3316d5eda60ac1fea355aa43d196feea3567384179b55ca88c8636c0322021ec`,
and `git diff --check` passes. These were the initial documentation-only checks.

For the subsequent two-string UI correction, frontend typecheck passed and the
nine existing history/head-recovery unit cases passed (12.45s). The actual
`UnlockPage`/`CopyModeProvider` source was also rendered in isolated Chrome with
a synthetic app context: one failed unlock and one explicit null-result search
in each language, zero restore calls or page errors. No backend, vault, account,
provider, candidate package or private browser profile was used. This bounded
component exercise is not a complete-product/browser acceptance test. No exact
wording assertion or permanent new test was added. [Scoped UI receipt](unlock-search-copy.json).

## Existing implementation and test references

These files were read for the correction. Only the two frontend history and
head-recovery unit files were executed after the additional UI copy change;
the backend suite and existing full-product browser scenarios were **not rerun**:

- [VaultSettings](../../../frontend/src/components/vault/VaultSettings.tsx) and
  [VaultHistoryPanel](../../../frontend/src/components/vault/VaultHistoryPanel.tsx):
  panel reachability, revision preview and `saveEntries` forward restore.
- [UnlockPage](../../../frontend/src/pages/UnlockPage.tsx) and
  [vault lifecycle](../../../frontend/src/modules/vault-lifecycle/index.ts):
  failed unlock, separate search/confirmation and normal lifecycle wiring.
- [vault-session](../../../frontend/src/lib/vault-session.ts):
  `openHistoricEntries`, `findRecoverableRevision`, `restoreRecoveredRevision`
  and `commitEntries`; [backend CAS/version checks](../../../backend/app/services/snapshots.py)
  remain unchanged.
- [History unit cases](../../../frontend/src/lib/vault-session.history.test.ts),
  [head-recovery unit cases](../../../frontend/src/lib/vault-session.head-recovery.test.ts)
  and [backend history cases](../../../backend/tests/security/test_revision_history.py):
  intact/foreign/tampered/key-mismatched history, unchanged pins and forward commit.
- Existing browser scenarios:
  [unlocked history](../../../frontend/e2e/local/vault-history.spec.ts) and
  [token-poisoned head after reload](../../../frontend/e2e/local/poisoned-head-recovery.spec.ts).
- [ADR-015](../../architecture/adr/ADR-015-write-authorization.md) keeps signed
  writes as a separately unimplemented stage; this correction does not implement it.
- [RC3 preparation](../../RELEASE-0.1.2-rc.3.md) remains a historical source note,
  not a record of publication. Artifact review scope and exact hashes are in
  [artifact-review.json](artifact-review.json).
