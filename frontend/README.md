# 4AllPass-Frontend

React, TypeScript und PWA mit Vite. Die maßgeblichen Kryptografie- und
Architekturspezifikationen stehen in der Dokumentation des Hauptverzeichnisses:

- [`../docs/architecture.md`](../docs/architecture.md)
- [`../docs/webauthn-prf.md`](../docs/webauthn-prf.md)

## Lokal einrichten

```sh
npm install        # from the repo root (npm workspaces)
npm run dev -w @4allpass/frontend
```

## Tests

```sh
npm run test -w @4allpass/frontend        # unit tests
npm run test:e2e -w @4allpass/frontend    # Playwright + virtual authenticator
npm run test:e2e:user-watch -w @4allpass/frontend  # V0–V8 dummy vault, screenshots
npm run typecheck -w @4allpass/frontend
npm run build -w @4allpass/frontend
```

Die Ende-zu-Ende-Tests steuern Backend mit PostgreSQL, Redis und uvicorn sowie
Chromes virtuellen Authentifikator. Sie schalten `hasPrf` und `hasLargeBlob` um,
um alle drei Entsperrungsränge abzudecken.

## Abläufe

**Tresor erstellen.** `vault_id` reservieren, zufälligen Vault Key erzeugen,
Master Key mit Argon2id ableiten, Master-/Wiederherstellungshüllen erzeugen und
Revision 1 festschreiben.

**Entsperren.** `active_revision` abrufen, Rücksprung gegenüber lokalem Pin
verweigern, Vault Key enthüllen, Integrität der Momentaufnahme prüfen und in den
Arbeitsspeicher entschlüsseln.

**Geräteentsperrung.** `@4allpass/webauthn` richtet den höchsten verfügbaren Rang
ein: PRF, largeBlob oder lokalen UV-gesicherten Speicher. Entsperrung:
Assertion → DWK → Device Key → Vault Key. Das Masterpasswort bleibt als Rückfallweg erhalten.

## Lebenszyklus beim Sperren

Beim Sperren wird der Vault Key bestmöglich genullt. In der PWA und in
`4AllPass.app` erfolgt dies nur durch die Schaltfläche zum Sperren, nicht durch
Ruhemodus, Bildschirmsperre, Menüleiste, Inaktivität oder versteckten Tab.
JavaScript kann das Löschen sämtlicher Kopien nicht garantieren; diese Grenze
ist im Bedrohungsmodell berücksichtigt.
