# Modulgrenzen des Frontends

Dieses Verzeichnis enthält die abgeschlossene Modulstruktur, die schrittweise
aus dem früheren zentralen Anwendungszustand herausgelöst wurde.

## Regeln

1. Jedes Modul veröffentlicht seine API ausschließlich über seine `index.ts`.
2. Ein Modul darf seine eigenen internen Ordner verwenden.
3. Importe aus anderen Modulen müssen deren öffentlichen Einstiegspunkt verwenden.
4. Kein UI-Modul übernimmt Kryptografie-/Momentaufnahmeformate, CAS oder Schlüsselversionen; diese Verantwortung verbleibt in der zuständigen tieferen Kryptografie-/Kernschicht.
5. Kompatibilitätsdateien unter `frontend/src/lib/` dürfen vorübergehend Modul-APIs für ältere Aufrufer weiter exportieren; neue modulübergreifende Aufrufe verwenden den Moduleinstiegspunkt.
6. Zuständigkeiten getrennt halten, damit Änderungen unabhängig prüfbar und rücknehmbar bleiben.

Der Hauptbefehl `npm run check:module-boundaries` verweigert tiefe Importe über Modulgrenzen.

## Abgeschlossene Migration

`feedback → account → startup/app-shell → vault-lifecycle → recovery-management → entries
→ import/browser-profiles → autofill → devices/device-management → sharing
→ settings/agent-access → desktop-adapter`.

Die Migration erfolgte in kleinen PRs mit vorgeschriebener CI, CodeQL und
Geheimnissuche vor dem Zusammenführen.

## Zuständigkeiten

- `app-shell`: Zusammensetzung, Rückmeldungsanbindung und stabile öffentliche Anwendungs-API.
- `account`: Anmeldung, Registrierung, lokale Sitzung und Trennung des Kontopassworts.
- `startup`: Start, Sitzungswiederherstellung und lokaler Speicherstatus.
- `vault-lifecycle`: Tresorwahl, Erstellen/Wiederherstellen, Sperren/Entsperren, Import in den geöffneten Tresor und Eintragscommits.
- `device-management`: Biometrie, Geräteliste und Widerrufskoordination.
- `devices`: stabile lokale Geräteidentität und Hilfen für WebAuthn-RP-/Gerätebeschreibung.
- `recovery-management`: Ersatz vertrauter Wiederherstellung und Rotation kompromittierter Wiederherstellung.
- `entries`: Klartexteintragsschema und clientseitige Eintragshilfen.
- `import`: öffentliche Importgrenze für vorhandenes Einlese-/Zusammenführungsverhalten.
- `browser-profiles`: Browser-/Profilsuche, Browserimport und lokaler Aktivierungszustand.
- `autofill`: Autofill-Domänenhilfen des Frontends; die Erweiterungsengine bleibt getrennt.
- `sharing`: Erstellen, Öffnen und Herunterladen selektiver verschlüsselter Freigabepakete.
- `settings`: Einstellungstexte und zugehörige Frontend-Einstellungsoberfläche.
- `agent-access`: Frontend-Agentenzugriffsadapter und Demonstration; Regeln verbleiben in `@4allpass/core`.
- `desktop-adapter`: optionaler Tauri-/Autostart-/Ereignisadapter ohne Zuständigkeit für Tresorgeheimnisse.

Kryptografieprotokoll, CAS-Bedeutung, versiegelte Momentaufnahmeformate und
Schlüsselversionsregeln dürfen nicht in diese UI-Module verlagert werden.
