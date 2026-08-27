# UI-Map — digitales Papier-Wireframe

**Status:** Flächenkarte für Grok Build. Keine Spec.  
**Shape:** [`architecture.md`](architecture.md). **Was läuft:** [`security-boundary.md`](security-boundary.md).

Eine View = ein Kasten. Zahl = Fläche. Ein Satz daneben. HTML-Wireframe öffnen (Magpie, nummeriert). Foto optional daneben.

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
| 1 | Wordmark 4AllPass (Elster + Schlüssel). |
| 2 | Tresor offen/gesperrt; Sperren; Abmelden nur mit Account. |
| 3 | `error` / `notice`. Schließen räumt die Meldung. |
| 4 | Eine der Views V1–V8. |

> Screenshot: `docs/screenshots/v0-chrome.png`

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
| 2–3 | Account, nicht Master-Passwort. |
| 4 | `auth-submit`. 409 → Anmelden. |
| 5 | Wechselt den Modus. |

> Screenshot: `docs/screenshots/v1-auth.png`

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

> Screenshot: `docs/screenshots/v2-create.png`

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

> Screenshot: `docs/screenshots/v3-unlock.png`

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

> Screenshot: `docs/screenshots/v5-browser.png`

---

## V6 Zugriff

```
┌──────────────────────────┐
│ 1 Eine Frage: welches    │
│   Programm darf was?     │
│ 2 Allow / Deny           │
└──────────────────────────┘
```

| # | Tut |
|---|---|
| 1 | Demo + echte Broker-Anfrage. Kein Roh-Passwort ohne Allow. |
| 2 | Mensch entscheidet. TTL holt eine Kopie nicht zurück. |

> Screenshot: `docs/screenshots/v6-access.png`

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

> Screenshot: `docs/screenshots/v7-settings.png`

---

## V8 Overlays

Import-Review · Share-Datei · Share öffnen · Recovery-Kit.

Jeweils: Titel, Warnung, eine primäre Aktion, Abbrechen. Server sieht keinen Klartext.

> Screenshot: `docs/screenshots/v8-import.png`

---

Neue Fläche? Erst hier eine Nummer, dann Code. Tokens: [`architecture.md`](architecture.md) §3.
