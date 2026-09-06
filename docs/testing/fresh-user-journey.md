# Fresh User Journey — Desktop Test Suite

Status: first executable end-to-end path.

## Ziel

Die Suite verhält sich wie ein neuer normaler Nutzer im Desktop-Modus:

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

Die Suite benutzt nur eine isolierte Test-Datenbank und niemals Daniels echten Tresor oder Port 8788.

## Live ansehen

```bash
npm run test:e2e:fresh-user -w @4allpass/frontend
```

Playwright läuft mit der vorhandenen Desktop-Watch-Konfiguration sichtbar und langsam genug zum Beobachten.

## Fehlerpaket

Jeder Schritt erzeugt ein Bild. Zusätzlich entsteht `journey.json` mit:

- Schrittname
- gestartet / bestanden / fehlgeschlagen
- Zeitpunkt
- Fehlermeldung
- Name des Fehler-Screenshots

Standardordner:

`~/gnom-hub-v1/docs/assets/fresh-user-journey/`

Alternativ kann `FOURALLPASS_JOURNEY_ARTIFACTS` gesetzt werden.

## Reparatur-Schleife für KI-Agenten

Bei einem Fehler:

1. `journey.json` lesen.
2. Den ersten fehlgeschlagenen Schritt nehmen.
3. Den zugehörigen Screenshot ansehen.
4. Nur das verantwortliche Modul untersuchen.
5. Ursache reparieren, nicht den Test passend machen.
6. Modul-/Unit-Tests ausführen.
7. `test:e2e:fresh-user` erneut vollständig ausführen.
8. Erst weitergehen, wenn der gesamte Nutzerweg grün ist.

## Noch getrennt zu testen

Dieser Test prüft die Desktop-Logik mit dem bestehenden Tauri-Stub. Er behauptet ausdrücklich nicht, einen echten macOS-/Windows-Installer installiert zu haben. Ein echter Fremd-Mac-/Windows-Installer-Test bleibt eine eigene OS-Teststufe.
