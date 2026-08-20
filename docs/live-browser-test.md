# Live-Browser-Test (dein Mac)

Kein Headless-CI. Fenster gehen auf, Maus klickt, Tastatur tippt. Danach siehst du, **warum** Chrome, Firefox, Brave und Safari deine Passwörter nicht „einfach so“ teilen — und wann sie es tun.

Bestehende Chrome-Tests mit virtuellem Authenticator bleiben: `frontend/e2e/device-unlock.spec.ts`.

---

## Was du beobachten sollst

4AllPass synchronisiert **keinen Klartext** zwischen Browsern.

| Schritt | Was der Browser zeigt | Was der Server hat |
|---|---|---|
| Nur angemeldet | Vault **LOCKED**, keine Einträge | Undurchsichtige Envelopes |
| Vault-Passwort getippt | Einträge lesbar | immer noch nur Ciphertext |
| Anderer Browser, nur Login | wieder **LOCKED** | dasselbe Snapshot |
| Anderer Browser, Vault-Passwort | dieselben Einträge | unverändert |

Der Server kann die Einträge nicht lesen. Jeder Browser entschlüsselt lokal, nachdem **du** das Vault-Passwort (oder den Recovery Key) dort eingegeben hast. Das ist kein Chrome-/iCloud-Passwort-Sync.

Auf diesem Rechner gefunden: Google Chrome, Firefox, Brave, Safari. Opera/Edge werden mitgenommen, falls sie unter `/Applications` liegen. Safari steuert Playwright über **WebKit** (dieselbe Engine); `Safari.app` selbst hat keine Playwright-Anbindung.

---

## Einmal vorbereiten

Backend (Postgres + Redis + API) und PWA:

```sh
cd ~/4AllPass
docker compose up -d postgres redis
# API auf :8010 — :8000 is another app on this machine, not 4AllPass:
cd backend && source .venv/bin/activate && alembic upgrade head \
  && FOURALLPASS_SESSION_SECRET=dev-e2e-session-not-for-production \
     uvicorn app.main:app --host 127.0.0.1 --port 8010
# anderes Terminal:
cd ~/4AllPass/frontend && API_ORIGIN=http://127.0.0.1:8010 npm run dev -- --host 127.0.0.1
```

Browser-Engines für Playwright (einmal):

```sh
cd ~/4AllPass/frontend
npx playwright install firefox webkit
```

Chrome/Brave/Firefox.app sind die Programme aus `/Applications`.

---

## Automatisch zusehen (Maus + Tastatur)

Langsam, Fenster sichtbar:

```sh
cd ~/4AllPass
LIVE_SLOWMO=350 npm run test:e2e:live -w @4allpass/frontend
```

Noch langsamer zum Vorführen: `LIVE_SLOWMO=500`.

Der Lauf:

1. **Chrome** — Konto anlegen, Vault, Recovery-Kit bestätigen, zwei Einträge (GitHub, Bank) tippen.
2. Snapshot vom Server prüfen: Titel/User/Passwort kommen **nicht** im JSON vor.
3. **Jeder weitere Browser** (Firefox, Brave, WebKit, …) — nur Account-Login → Vault bleibt zu, Einträge unsichtbar.
4. Falsches Vault-Passwort → Fehler, weiter zu.
5. Richtiges Vault-Passwort → dieselben Einträge.
6. In Chrome einen dritten Eintrag **Forum** anlegen; im zweiten Browser neu entsperren → Forum ist da.
7. Im letzten Browser mit **Recovery Key** entsperren.
8. Extra: Chrome nur mit Tastatur (Tab / Tippen / Enter) durch Account + Vault.

---

## Manuell mit der Maus (gleiche Geschichte)

Gleicher Account in jedem Browser. Werte selbst wählen, nicht die Test-Konstanten aus dem Spec nehmen, wenn du produktiv spielst.

1. **Chrome**  
   Konto anlegen → Vault-Passwort (nicht das Anmeldepasswort) → Recovery Key downloaden/drucken, Haken, Continue → Eintrag speichern (z. B. Titel `GitHub`).
2. **Firefox** (neues Profil reicht)  
   Dieselbe E-Mail, Anmeldepasswort. Du siehst **Vault locked**, nicht `GitHub`.  
   Vault-Passwort tippen → `GitHub` erscheint.
3. **Brave** — wie Firefox.
4. **Safari** — wie Firefox.
5. In Chrome einen zweiten Eintrag speichern. In Firefox **Lock**, dann wieder Vault-Passwort → neuer Eintrag da.
6. Optional: in einem Browser **Unlock with this device** (Touch ID). Das gilt nur für **dieses** Browser-Profil, nicht für Firefox.

Wenn Schritt 2 die Einträge ohne Vault-Passwort zeigt, ist das ein Bug — nicht „Sync ist kaputt“, sondern Zero-Knowledge ist gebrochen.

---

## Erweiterung, die schon im Lauf steckt

- Ciphertext-Probe gegen `/api/v1/vaults/{id}/snapshot`
- Falsches Vault-Passwort
- Nachzug eines neuen Eintrags in den anderen Browser
- Recovery Key statt Vault-Passwort
- Tastatur-only in Chrome

Hard-Revoke über zwei echte Browser: `frontend/e2e/live/hard-revoke.spec.ts` (API **:8010**; VK++ ; Rotation killt Sessions des Opfers — neu anmelden, dann Vault-Passwort → VK₂). Noch nicht automatisiert: echtes Touch ID in Safari.app, Extension-Fill in Safari.app. Installed Firefox.app may fail Playwright’s protocol; Chrome + Brave is enough for two-app proof.

---

## Abgrenzung zum alten E2E

| | `npm run test:e2e` | `npm run test:e2e:live` |
|---|---|---|
| Browser | ein Chrome, virtuelle WebAuthn | echte Apps, mehrere Fenster |
| Sichtbar | meist headless/CI | immer headed, `slowMo` |
| Zweck | Device-Unlock-Ränge + Revoke | Siehst du Sync vs. Entschlüsseln |
