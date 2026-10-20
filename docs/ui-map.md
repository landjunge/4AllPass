# UI-Map — digitales Papier-Wireframe

**Status:** Flächenkarte für Grok Build. Keine Spec.  
**Shape:** [`architecture.md`](architecture.md). **Was läuft:** [`security-boundary.md`](security-boundary.md).

Eine View = ein Kasten. Zahl = Fläche. Ein Satz daneben. HTML-Wireframe öffnen (Gnom-Hub-V1-Grau, nummeriert): [screenshots/index.html](screenshots/index.html).

---

## V0 App-Chrome (jede Seite)

```
┌──────────────────────────┐
│ 1 Logo        2 Lock/Mail│
│ 3 Banner (nur bei Fehler)│
│ 4 main                   │
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | 4AllPass mit freigegebenem AP4-Rastermotiv (brand/README.md). |
| 2 | Tresor offen/gesperrt; Sperren; Abmelden nur mit Account. |
| 3 | `error` / `notice`. Schließen räumt die Meldung. Nach bestätigtem Hard-Revoke-Commit bleibt der DE/EN-Teilabschluss mit „Geräteentzug prüfen“ auch gesperrt sichtbar; prüft nur ausstehendes DELETE/GET, nie eine zweite Rotation. Dieser Abgleich endet beim Abmelden/Neuladen. Offener Tresor + Einträge noch auf `local@`: Passwort einmal, Merge hierher. Nicht abmelden, nicht sperren. |
| 4 | Eine der Views V1–V8. |

> Wireframe: [v0-chrome.html](screenshots/v0-chrome.html)

---

## V1 Auth

```
┌──────────────────────────┐
│ 1 Titel Konto / Anmelden │
│ 2 E-Mail                 │
│ 3 Konto-Passwort         │
│ 4 Submit  5 Wechsel      │
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | Eine Frage: Konto anlegen oder anmelden. Öffnet den Tresor nicht. |
| 2–3 | Account, nicht Master-Passwort. Neue Registrierung:15–256 Unicode-Zeichen, offline bekannte/erwartete Gesamtwerte verweigern; feste DE/EN-Fehler. Bestehende Anmeldung behält ihre bisherige Passwortprüfung. |
| 4 | `auth-submit`. 409 → Anmelden. |
| 5 | Wechselt den Modus. |

> Wireframe: [v1-auth.html](screenshots/v1-auth.html)

---

## V2 Tresor anlegen / wiederherstellen

```
┌──────────────────────────┐
│ 1 Titel                  │
│ 2 Master + Wiederholen   │
│ 3 Anlegen | Ich hab einen│
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | Eine Frage: Tresor-Passwort wählen. |
| 2 | Bleibt auf dem Gerät. Mismatch blockt Submit. |
| 3 | Anlegen → Recovery-Kit. Link → Restore-Datei + Share-Key. |

> Wireframe: [v2-create.html](screenshots/v2-create.html)

---

## V3 Unlock

```
┌──────────────────────────┐
│ 1 Gerät öffnen (optional)│
│ 2 Master oder Recovery   │
│ 3 Unlock                 │
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | WebAuthn auf diesem Gerät. Rang 3 ist nur Policy, kein PRF. |
| 2 | Master oder Recovery-Key. Nie an den Server. |
| 3 | Entschlüsselt Snapshot → VaultPage. |

> Wireframe: [v3-unlock.html](screenshots/v3-unlock.html)

---

## V4 Tresor-Desk (Hauptfläche)

```
┌──────────────────────────────┐
│ 1 Tabs: Tresor Browser Zugriff│
│     Einstellungen            │
│ ┌────────────┬─────────────┐ │
│ │2 Hero+Score│             │ │
│ │3 Suche+Chip│ 6 Detail    │ │
│ │4 Favoriten │    oder     │ │
│ │5 Aufmerksamkeit│ Empty   │ │
│ │  Zuletzt geänd.│         │ │
│ └────────────┴─────────────┘ │
└──────────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | Eine Hierarchie: Tresor / Browser / Zugriff / Einstellungen. |
| 2 | „Welchen Zugang suche ich?“ Count. Score ab 5 Einträgen (lokal, kein Server). |
| 3 | Sticky Suche, live. Filter Alle / Logins / API / Server / Kurz. Plus + Import. |
| 4 | Sterne gold. Stern-Tap toggelt `favorite`. Rest der Row öffnet Detail. |
| 5 | Geleakt / doppelt / schwach, dann alle anderen nach `updatedAt`. Icon + Titel + User/Host + Badge. |
| 6 | Formular in Fragen (Art → Name → Zugang). Kopieren am Feld. Oder Empty mit Login/API/Server. |

Handy: Spalten unter 820 px untereinander.

> Wireframe: [v4-desk.html](screenshots/v4-desk.html) · [v4-desk-empty.html](screenshots/v4-desk-empty.html) · [v4-desk-phone.html](screenshots/v4-desk-phone.html)  
> Foto optional: `docs/screenshots/v4-desk.png`

---

## V5 Browser

```
┌──────────────────────────┐
│ 1 Karten je Browser      │
│ 2 Profile anhaken        │
│ 3 Passwörter holen       │
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | Welcher Browser auf diesem Mac. |
| 2 | Welche Profile. Kein Autofill-Grant. |
| 3 | Import-Review: Host + User, **kein** Passwort in der Liste. |

> Wireframe: [v5-browser.html](screenshots/v5-browser.html)

---

## V6 Zugriff

Die bestehende Zugriff-Fläche erklärt die Sperre für Maschinenzugriff, weil kein
geschützter produktiver Nutzungsweg verbunden ist. Kein Allow-Knopf, keine
Rohmaterial-Demo und kein Secret-Verbindungsrezept. Normale Tresor-/Browser-/
Einstellungs-Tabs bleiben erhalten. DE/EN, kompakte Card, semantischer Status.

Der getrennt vorhandene optionale `LocalBrokerConnect`-Baustein zeigt vor der
ersten akzeptierten Poll-Antwort „verbindet“ und bei Transportfehlern verständliche
DE/EN-Hinweise. Das ist keine neue Freigabe oder Wiedereinführung in die gesperrte
Zugriff-Fläche und kein authentisierter Verbund-/Tresorstatus.

Historische Wireframes unter screenshots/v6-access.html zeigen den alten
Raw-Secret-Entwurf und sind keine Zusage des aktuellen Quellstands.

---

## V7 Einstellungen

```
┌──────────────────────────┐
│ 1 Allgemein | Geräte |   │
│   Sicherheit             │
│ 2 Pane                   │
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | Untertabs. Geräte = Biometrie + Revoke (DELETE = metadata_only). |
| 2 | Sicherheit = Revision nur zur Kontrolle, nicht Alltag. |
| 3 | Sicherheit → **Frühere Stände**: Liste älterer Stände (Datum · Anzahl Einträge). Lesen ist kein Zurückdrehen. |

**V7.3 Frühere Stände.** Eine Frage: *Was war vorher drin?* Pro Zeile Datum und
Anzahl Einträge, aktueller Stand markiert. Stände von vor einem
Schlüsselwechsel sind nicht lesbar und werden als solche benannt, nicht
versteckt. Öffnen zeigt die Titel/Benutzer dieses Standes — **nie Passwörter**.
Wiederherstellen legt einen **neuen** Stand an; nichts wird zurückgedreht und
nichts gelöscht. Gehört hierher, nicht auf den Desk: Stände sind Kontrolle,
kein Alltag.

> Wireframe: [v7-settings.html](screenshots/v7-settings.html)

---

## V8 Overlays

Import-Review · Share-Datei · Share öffnen · Recovery-Kit.

Jeweils: Titel, Warnung, eine primäre Aktion, Abbrechen. Server sieht keinen Klartext.  
Import-Review zeigt Art (Login / API-Key / Server) · Host oder Provider · User — **kein** Secret.

> Wireframe: [v8-import.html](screenshots/v8-import.html)

---

Neue Fläche? Erst hier eine Nummer, dann Code. Tokens: [`architecture.md`](architecture.md) §3.

## Gemeinsame Bedienbasis / shared foundation (FP-D01)

`frontend/src/networkpunkt.css` is the unchanged portable foundation from PR216,
Git blob `673f4e265c8c46618ba86d9e98f8da09fd0bf107`; `tokens.css` adapts its roles.
4AllPass keeps AP4, existing narrow-window stacking below 820px and 44px touch
controls. The old PR216 blanket 1180px minimum/hidden scrollbars/removal of touch
rules is not adopted. New blocked machine access states remain truthful in DE/EN.
