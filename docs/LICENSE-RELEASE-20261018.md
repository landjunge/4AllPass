# Neue lizenzierte Desktop-Pakete · 0.1.2-rc.2

## Deutsch

Die vom Betreiber auf main übernommene Netzwerkpunkt Personal Use License1.0
gilt für die jetzt darunter angebotenen eigenen Beiträge. Deutsche Fassung
maßgeblich, englische Übersetzung; individuelle Source-available-Vorlage,
kein OSI-Standard und nicht anwaltlich geprüft. Fremdlizenzen und historische
Rechte bleiben bestehen. Frühere Tags, Pakete, Signaturen und Hashes werden
nicht ersetzt und nicht nachträglich als neu lizenziert dargestellt.

Neuer Paketstand0.1.2-rc.2: LICENSE im App-Ressourcenbündel, im Python-Sidecar,
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

## Durch die Paketprobe gefundene Fehler

Die ARM-macOS-Paketprobe scheiterte vor Datenbankbereitschaft, weil `greenlet`
in der tatsächlichen Pip-Installation fehlte (nicht nur eine vermutete fehlende
PyInstaller-Erkennung). Vorheriger Buildpin a13c3fb, kompakter Beleg im CI-Lauf
39128531456. Die bereits verwendete SQLAlchemy-Asyncio-Laufzeit wird deshalb
ausdrücklich mit `sqlalchemy[asyncio]` installiert und beim Verpacken aufgenommen.
Kein neuer Datenbankweg und keine Kryptografieänderung.
[SQLAlchemy: Installation einschließlich Apple M1](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html#asyncio-platform-installation-notes-including-apple-m1).

Die Windows-Paketprüfung hatte bereits den eingebetteten LICENSE-Inhalt geprüft,
scheiterte danach am Autoload des Signaturmoduls in Windows PowerShell5 unter der
PowerShell7-Umgebung des Runners. Der Prüfhelfer verwendet jetzt dessen vorhandenes
`pwsh`. Ein Fehler wird nicht als „unsigniert“ umgedeutet. Laufzeitprüfung erfolgt
vor dem teuren nativen Bündeln; bei identischem Sidecar-Hash wird ihr Beleg im
nachfolgenden Paketcheck wiederverwendet. Kompakte Fehler bleiben als Beleg
erhalten; unklare Starts werden nicht als Erfolg markiert.

## English

New0.1.2-rc.2 packages carry the operator-adopted Netzwerkpunkt Personal Use
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

## Paket-Startfehler abgeschlossen, danach AP4

Windows-Lauf 39129234492 (2767afb) besteht nach begrenztem Beenden des eigenen
PyInstaller-Prozessbaums vollständig. Der vorherige Prüflauf hatte nur den
Onefile-Elternprozess beendet; sein Kind hielt die synthetische Datenbankdatei
offen (WinError32). Keine fremden Prozesse werden beendet. ARM-macOS, Intel-
macOS und Linux bestehen im Lauf39128882517 (3165954); dessen Windows-Teil ist
der erhaltene Fehlerbeleg vor der Prozessbaumkorrektur.

Diese CI-Pakete ohne AP4 werden nicht veröffentlicht. Der neue Kandidat
0.1.2-rc.2 enthält die am18.10. freigegebenen Originale und bereitgestellten
Größen; Herkunft, Hashes und feste native Dark-Wahl stehen in brand/README.md.
Die isolierte Browserprobe zeigt beide Varianten bei16/24/32/48/64/96/128px
in echter CSS-Größe (DPR1) und das tatsächliche App-Kopfzeilenbild. Bei16px
bleiben die feinen Raster-/Konturdetails naturgemäß schwer erkennbar; kein
vereinfachtes Ersatzmotiv wird eingeführt. Paketprüfungen kontrollieren zusätzlich
die nativen AP4-Icons sowie Icons und LICENSE der eingebetteten Erweiterungen.

Der Windows-Vorläufer hatte durch Git-Checkout CRLF statt LF in LICENSE.
Der Wortlaut war gleich, der Bytehash abweichend. Die neue gezielte
.gitattributes-Regel erzwingt LF; der Freigabecheck verlangt den gemeinsamen
Originalhash3316d5ed…2021ec. Vorläuferbelege bleiben unverändert erhalten.

The startup corrections are evidenced by the completed native package checks
above. Those pre-AP4 candidates are not published. Candidate0.1.2-rc.2 uses the
approved, hash-preserved raster assets. Small-size detail is limited at16px;
no automatic simplification. Native theme choice and original provenance are
recorded in brand/README.md. LICENSE now retains identical LF bytes on Windows
as well, with an explicit original-hash guard.

## Zusätzlich belegter Oberflächenfehler vor Freigabe

Der bestehende Backend-CI-Lauf blieb nach26 bestandenen Tests bei der ersten
Dateiauslieferungsprobe stehen. Lokale Einzelreproduktion mit Python3.12,
Starlette1.8.0 und Timeout-Stack zeigte eine Endlosschleife in FileResponse:
BodyLimitMiddleware lieferte nach dem gepufferten Request endlos sofortige
leere http.request-Nachrichten. Dadurch wurde der parallele Streaming-Task
bei ASGI-Versionen vor2.4 nicht eingeplant. Das ist ein Middlewarefehler,
kein Grund, die Traversal-Prüfung zu überspringen oder Datenbank-/Crypto-
Berechtigungen zu ändern.

Nach dem einmaligen Body-Replay wartet die Middleware jetzt auf das echte
Receive des Transports (einschließlich tatsächlichem Disconnect). Keine
künstliche Trennung einer noch laufenden Antwort. Alle16 gezielten Bodylimit-
und Traversal-/Dateiprüfungen bestehen lokal in1.08s; Größenbegrenzung und
Pfadgrenze bleiben erhalten. Die Paket-Vorabprobe verlangt jetzt zusätzlich
HTML und das bytegleiche AP4-Favicon, jeweils mit begrenztem Netzwerk-Timeout.
Gesundheit allein wird nicht als benutzbare Oberfläche gewertet.

A reproduced middleware busy loop could starve FileResponse streaming on
ASGI<2.4. Replaying the body once and then awaiting the real transport fixes
it while preserving real disconnects and body limits. Sixteen targeted checks
pass; packaged startup now checks bounded HTML and exact AP4-favicon delivery.
