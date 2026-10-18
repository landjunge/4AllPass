# Neue lizenzierte Desktop-Pakete · 0.1.2-rc.1

## Deutsch

Die vom Betreiber auf main übernommene Netzwerkpunkt Personal Use License1.0
gilt für die jetzt darunter angebotenen eigenen Beiträge. Deutsche Fassung
maßgeblich, englische Übersetzung; individuelle Source-available-Vorlage,
kein OSI-Standard und nicht anwaltlich geprüft. Fremdlizenzen und historische
Rechte bleiben bestehen. Frühere Tags, Pakete, Signaturen und Hashes werden
nicht ersetzt und nicht nachträglich als neu lizenziert dargestellt.

Neuer Paketstand0.1.2-rc.1: LICENSE im App-Ressourcenbündel, im Python-Sidecar,
auf dem Mac-DMG und als separates Release-Asset. Windows verwendet die
Lizenzdatei außerdem im NSIS-Installationsablauf. Cargo verweist auf die Datei;
die eigenen npm-Workspaces auf den tatsächlichen relativen LICENSE-Pfad.
Die bestehende Lizenzanzeige unter Einstellungen nennt jetzt die übernommenen
Bedingungen in DE/EN. Kein Eingriff in Tresor, Kryptografie oder Zugangsdaten.

Die bestehende Desktop-Pipeline wird ausschließlich ausdrücklich für einen
festen Quellstand ausgelöst. Kein automatisches Veröffentlichen oder Verschieben
des historischen `desktop`-Tags. Sie baut die vier vorhandenen Ziele und prüft
Paket-Lizenz, unveränderte macOS-Codesign-Gültigkeit, Windows-Signaturstatus
und einen Sidecar-Start mit temporären synthetischen Daten. Datenbankgesundheit
ist keine vollständige GUI-/Autofill-Abnahme. Kein persönlicher Tresor oder
Account wird geöffnet. Gefundene Drittanbieter-Lizenztexte und ein konkretes
Inventar werden erhalten; dieses ist kein rechtliches Kompatibilitätsgutachten.

Vor Veröffentlichung müssen die gewählten Pakete tatsächlich gebaut und
geprüft sein. Separate LICENSE, Quell-/Plattformbelege und neue SHA-256-Dateien
werden gemeinsam bereitgestellt. Erst danach werden die regulären Installer-
und Downloadziele auf den neuen festen Tag umgestellt. Historisches `desktop`
bleibt als historische Fassung erreichbar.

Beim Vorbereiten zeigte der aktuelle npm-Lockstand zwei hohe und eine mittlere
Build-Abhängigkeitsmeldung. Gezielt innerhalb vorhandener Versionsbereiche
aktualisiert: brace-expansion, source-map-js und fast-uri. Kein pauschales
`npm audit fix`; kein neuer direkter Baustein. Der neue Lockstand meldet0
npm-Auditbefunde. Das ist keine Garantie gegen unbekannte Schwachstellen.

## English

New0.1.2-rc.1 packages carry the operator-adopted Netzwerkpunkt Personal Use
License1.0 in application resources, the Python sidecar, the macOS disk image
and a separate release asset. German governs; English is a translation.
Custom source-available terms, not an OSI standard or legal review. Third-party
licenses and historical rights remain. Historical packages/tags/signatures/hashes
are preserved and not retroactively relabeled.

The existing workflow now builds pinned candidates only on explicit dispatch;
it no longer changes the historical rolling `desktop` tag. Per-platform evidence
covers packaged license files and synthetic isolated sidecar/database startup;
not full GUI/autofill acceptance. Available third-party notices and dependency
inventory are preserved without claiming a compatibility opinion. Downloads
and installer defaults switch only after the complete checked release exists.

Three existing build dependency audit findings were addressed with scoped
updates within existing ranges: brace-expansion, source-map-js and fast-uri.
No new direct dependency or blanket audit fix. The resulting npm audit has no
reported findings, without implying permanent security.
