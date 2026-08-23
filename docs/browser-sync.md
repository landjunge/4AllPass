# Plan — Browser-Sync ist die Basics

Stand: 2026-08-23. **Plan, noch nicht gebaut.**  
Produkt laut dir: Karten aller installierten Browser → Profile anhaken → Passwörter sind in 4AllPass und damit **sync** (ein Tresor, alle gewählten Profile).

Kein Core-Rewrite. Kein zweites Tauri. FastAPI sieht weiter **keine** Klartext-Passwörter. Agent/n8n bleibt im Code, ist **nicht** der erste Bildschirm.

---

## Was du sehen sollst (erster Test)

```text
App auf → Tresor auf
    → Karten: Chrome, Firefox, Safari, Brave, Edge, …
    → Profil anhaken
    → Passwörter stehen in der Liste
    → auf Webseiten ausfüllen (Extension, die schon existiert)
```

Nicht: leerer Tresor. Nicht: Allow/Deny als Start.

---

## Was wir nicht anfassen

| Bleibt | Warum |
|---|---|
| `packages/crypto` | Envelopes, Argon2id, AES-GCM |
| FastAPI / SQLite / CAS | nur Blobs |
| `VaultEntry` + `saveEntries` | Import landet **hier**, nicht in einem zweiten Speicher |
| `frontend/src/lib/import.ts` | CSV/Bitwarden bleibt; Browser-Zeilen werden **dasselbe** Format |
| Tauri-Fenster + Sidecar | nur **neue** Native-Commands |
| Chromium-Extension `extension/` | füllt Seiten aus dem Tresor — nicht neu schreiben |
| Access-Tab / Broker | ungenutzt lassen, nicht löschen |

Zerstören = Crypto, Vault-Format oder Desktop-Shell ersetzen. Das tun wir nicht.

---

## Was „Sync“ in v1 ehrlich heißt

**Hub = 4AllPass-Tresor.**

1. **Rein:** gewählte Browser-Profile → Einträge im Tresor (verschlüsselt wie jeder andere Eintrag).
2. **Raus aufs Web:** vorhandene Extension füllt Login-Formulare.
3. **Nicht v1:** in Chromes eigene `Login Data` zurückschreiben, während Chrome läuft. Browser sperren das. Wer „Profil A und Profil B sind in Chrome selbst identisch“ will, braucht v2 (oder die Extension statt Chromes Passwort-Manager).

v1 ist trotzdem dein Basics-Loop: **einmal klicken → alle gewählten Profile im Tresor sichtbar → überall ausfüllen.**

---

## Wo der neue Code hin muss (dünn)

```text
src-tauri/          list_browser_profiles, read_browser_logins
                    (FS + Keychain/DPAPI; Kopie der DB, nie die Live-Datei)

frontend            Browser-Karten-UI auf VaultPage (erster Tab)
                    ruft Native auf, mappt auf VaultEntry, saveEntries()

frontend/src/lib/import.ts   optional: Zeilen aus Native → asEntry() (schon da)

extension/          unverändert füllen; Unlock-Copy ehrlich halten
```

Keine neue Datenbank. Kein Python-Decrypt im Sidecar (Sidecar bleibt Blob-Store). Decrypt nur im **Tauri-Prozess auf dem Gerät**.

---

## Browser (dieser Intel-Mac zuerst)

| Browser | Erkennen | Lesen v1 | Schreiben in den Browser |
|---|---|---|---|
| Chrome / Chromium / Brave / Edge / Arc | Profil-Ordner unter `~/Library/Application Support/…` | `Login Data` (SQLite) + Keychain `Chrome Safe Storage` / Chromium-Variante | nein |
| Firefox / Firefox Nightly | `~/Library/Application Support/Firefox/Profiles` | `logins.json` + `key4.db` | nein |
| Safari | vorhanden ja/nein | **v1.1** (Keychain, extra Freigabe) | nein |
| Windows/Linux | nach Mac | gleiche Logik, andere Pfade | nein |

Chrome muss **zu** sein oder wir kopieren die DB nach `/tmp` (Datei ist gelockt, wenn Chrome offen ist). UI sagt: „Chrome schließen oder wir lesen eine Kopie — neue Logins seit dem Öffnen fehlen.“

macOS zeigt ggf. einen Keychain-Dialog. Das ist ein Klick, den du verstehst — nicht Gatekeeper.

---

## UI (wenig Klicks)

Nach Unlock, **bevor** die leere Liste:

1. Zeile: „Browser auf diesem Mac“
2. Karte pro gefundenem Browser (Icon, Name, Anzahl Profile)
3. Klick auf Karte → Profile mit Haken (Default, Arbeit, …)
4. Ein Button: **Übernehmen**
5. Bestätigung: „N Logins kommen in deinen Tresor. Der Server sieht sie nicht.“
6. Liste mit Passwörtern (die VaultPage, die schon existiert)

Kein Wizard mit fünf Screens. Access-Tab bleibt hinten.

Dedup: gleicher Host + Username → ein Eintrag, neueres Passwort gewinnt. Quelle in `notes` oder später ein optionales Feld — **kein** Schema-Break von `VaultEntry` in v1 (notes reicht).

---

## Bau-Reihenfolge (nicht parallel)

| # | Stück | Fertig wenn |
|---|---|---|
| 1 | Native: Browser + Profile **nur listen** (keine Passwörter) | Auf **diesem Intel-Mac**: Karten stimmen mit installierten Browsern |
| 2 | Native: gewähltes Chrome-Profil lesen → `VaultEntry[]` → `saveEntries` | Du siehst Chrome-Passwörter in der Liste |
| 3 | Firefox dasselbe | Zwei Karten, ein Tresor |
| 4 | Brave/Edge/Arc (Chromium-Pfade, gleicher Decrypt) | Weitere Karten ohne neuen Crypto-Pfad |
| 5 | Welcome/Vault: Karten **zuerst**, Access nicht als Einstieg | Erster Test ohne Erklärung |
| 6 | Extension: eine Anleitung in Settings „in Chrome laden“ | Ausfüllen auf einer Testseite |
| 7 | Safari lesen | extra, nach 2–6 |
| 8 | Zurückschreiben in Browser-DBs | nur wenn 2–6 sitzen; darf scheitern und dann ehrlich „geht nicht, Extension nutzen“ |

Schritt 1+2 sind der Nutzen. Ohne die siehst du wieder nichts.

---

## Sicherheit (unverhandelbar)

- Native liefert Klartext **nur** an die schon entsperrte UI. Nie an FastAPI, nie ins Log, nie in Notifications.
- Keychain-Passphrase nicht speichern.
- Kopie der Browser-DB nach dem Import löschen.
- Import nur nach Button, nicht still im Hintergrund.
- Tests: Fake-`Login Data` Fixture, nicht dein echter Chrome.

---

## Definition of Done (Basics)

- [ ] Dieser Intel-Mac: App auf, Tresor auf, **Karten** der installierten Browser.
- [ ] Zwei Chrome- oder Firefox-Profile anhaken → Passwörter in der Liste, **ohne** CSV.
- [ ] Server-SQLite bleibt undurchsichtig (kein Klartext in der DB).
- [ ] Crypto-Tests (`npm test`) unverändert grün.
- [ ] Access/n8n unverändert im Repo, nicht auf dem Startbildschirm.
- [ ] README DE+EN: „Browser-Profile in den Tresor“, nicht „Agent-Zugang“ als erste Zeile.

---

## Nächster Schritt (genau einer)

Schritt 1: Tauri `list_browser_profiles` + Karten-UI. Noch **keine** Passwörter lesen.  
Wenn die Karten auf diesem Mac stimmen: Schritt 2 Chrome lesen.
