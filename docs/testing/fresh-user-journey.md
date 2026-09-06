# Fresh User Journey — Desktop Test Suite

Status: ausführbarer Nutzerweg plus sequenzieller Suite-Runner.

## Ziel

Der erste Test verhält sich wie ein neuer normaler Nutzer im Desktop-Modus:

1. App startet frisch.
2. Registrierung.
3. Neuer Tresor + Recovery-Kit.
4. Abmelden.
5. Wieder anmelden.
6. Falsches Tresor-Passwort testen.
7. Richtig entsperren.
8. Login-Eintrag anlegen.
9. Browser-Seite öffnen.
10. Agenten-Zugriff öffnen.
11. Einstellungen, Geräte und Sicherheit öffnen.
12. Sperren und wieder entsperren.

Die Tests benutzen isolierte Test-Datenbanken und niemals Daniels echten Tresor oder Port 8788.

## Live ansehen

Nur den ersten Nutzerweg:

```bash
npm run test:e2e:fresh-user -w @4allpass/frontend
```

Die komplette selbständig lauffähige Suite:

```bash
npm run test:e2e:user-suite -w @4allpass/frontend
```

Reihenfolge:

1. `fresh-user` — Start, Konto, Tresor, Einträge, Browser, Agenten, Einstellungen.
2. `import-restore` — Import, Browser-Profile, Share/Restore und Vault-Lifecycle.
3. `autofill-local` — lokaler Autofill-/Extension-Pfad.

Der Geräteblock (`device-unlock` + `two-device`) braucht die echten E2E-Backend-Voraussetzungen aus `playwright.config.ts` und wird deshalb nur ausdrücklich zugeschaltet:

```bash
E2E_INCLUDE_DEVICE=1 npm run test:e2e:user-suite -w @4allpass/frontend
```

Für automatische KI-Wiederholungen ohne sichtbares Fenster:

```bash
npm run test:e2e:user-suite:headless -w @4allpass/frontend
```

Ein einzelner Abschnitt kann gezielt wiederholt werden:

```bash
npm run test:e2e:user-suite -w @4allpass/frontend -- fresh-user
npm run test:e2e:user-suite -w @4allpass/frontend -- import-restore
npm run test:e2e:user-suite -w @4allpass/frontend -- autofill-local
```

## Fehlerpaket

Der Fresh-User-Test erzeugt pro Schritt ein Bild und `journey.json` mit Schrittname, Status, Zeitpunkt, Fehlermeldung und Screenshot.

Der Suite-Runner schreibt zusätzlich `suite.json` mit allen Testblöcken, Status und `failedStage`. Er stoppt beim ersten fehlerhaften Block und nennt den verantwortlichen Modulbereich.

Standardordner:

- `~/gnom-hub-v1/docs/assets/fresh-user-journey/`
- `~/gnom-hub-v1/docs/assets/4allpass-user-suite/`

Die Ordner können mit `FOURALLPASS_JOURNEY_ARTIFACTS` bzw. `FOURALLPASS_SUITE_ARTIFACTS` geändert werden.

## Reparatur-Schleife für KI-Agenten

Bei einem Fehler:

1. `suite.json` lesen und `failedStage` bestimmen.
2. Bei `fresh-user` zusätzlich `journey.json` und den Fehler-Screenshot lesen.
3. Nur die dort genannte Modulgruppe untersuchen.
4. Ursache reparieren, nicht den Test passend machen.
5. Modul-/Unit-Tests ausführen.
6. Den fehlerhaften Suite-Abschnitt erneut ausführen.
7. Danach die komplette User-Suite erneut ausführen.
8. Erst weitergehen, wenn der gesamte Nutzerweg grün ist.

## Echte Installation bleibt eine eigene Stufe

Der Fresh-User-Test prüft Desktop-Logik mit dem bestehenden Tauri-Stub. Er behauptet ausdrücklich nicht, einen echten macOS-/Windows-Installer installiert zu haben. Ein echter Fremd-Mac-/Windows-Installer-Test bleibt eine eigene OS-Teststufe.
