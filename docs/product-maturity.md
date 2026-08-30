# Produktreife — 4AllPass

Stand: 2026-08-28. **v3.** Kein Core-Rewrite, kein zweites Tauri, kein Tollgate. Audit-Freeze `#123` und Security Freeze #2 auf `main`. P0–P1 Code + UI-Hierarchie (Tresor · Browser · Zugriff · Einstellungen) auf `main`. Was der laufende Code erzwingt: [`security-boundary.md`](security-boundary.md).

> **4AllPass makes authentication effortless for humans and controlled for machines.**  
> DE: Anmeldung soll für Menschen einfach sein. Maschinen bekommen Zugang nur kontrolliert.

FastAPI gibt **keine** Tokens aus. Launch-Posts nicht auto-publishen.

v3 ersetzt v2 nicht in der Reihenfolge. v3 macht die Reihenfolge **zukunftssicher**: eine Credential-Engine für Mensch und Maschine, gebaut gegen die Stellen, an denen die Konkurrenz 2026 die meiste Kritik bekommt.

```text
HUMANS                         MACHINES
   │                              │
Reliable auth                  Controlled access
   │                              │
Autofill / Import              Agent / Capability
   │                              │
   └──────────────┬──────────────┘
                  ▼
          Credential Engine  →  Vault
```

Nicht: nächster Bitwarden/1Password. Differenzierung ist **Vault + zuverlässiges Autofill + kontrollierter Agent-Zugang**.

---

## Product strategy (five lines)

1. Credentials easy to use.
2. Autofill reliable.
3. Storage secure (ZK, this device).
4. Access controllable.
5. **Goal:** agents should not need the underlying long-lived secret.  
   **Current v1:** human-approved raw-secret handoff. TTL limits future handoffs, not a copied credential.

**Reliability before expansion.** Keine 20 neuen Features, solange Install, Import, Provider, Autofill, Vault nicht zuverlässig sind.

---

## Warum v3 (Konkurrenz 2026)

Die meiste Kritik sitzt nicht an der Krypto. Sie sitzt am Alltag, am Preis, an Recovery-Lügen und daran, dass niemand Agenten sauber bedient. Quellen: öffentliche Reviews, Foren, Store-Feedback, Stand August 2026 — keine eigenen Messungen fremder Binaries.

| Produkt | Wo es blutet | 4AllPass-Antwort |
|---|---|---|
| **Bitwarden** | Autofill hit-or-miss, iOS extra Klicks, UI nach Redesign, Premium ~2× in 2026 | Autofill ist das Produkt (P1). Keine Lizenz. |
| **1Password** | Teuer + steigend, Feature-Bloat, Electron/RAM, kein Self-Host | Eine Engine, Freeze, Desktop lokal |
| **Proton Pass** | Autofill unzuverlässig (Android, Multi-Step, viele Seiten) | Field Intelligence + Safe Fill + Verify |
| **KeePassXC** | Sync/Backup selbst, Mobile-Splitter, Passkeys holprig | App ist das Produkt, nicht eine `.kdbx`-Datei |
| **LastPass** | Recovery vs. Zero-Knowledge, Vertrauensbruch | Kit erzwungen, kein Server-Reset |
| **Vaultwarden** | Du bist Ops (Backup, Uptime), unaudited | Desktop-App, nicht Postgres-Pflicht |
| **Alle (2026)** | Agenten brauchen Keys, bekommen Dauer-Secrets | Allow/Deny + TTL. Ziel: kein langlebiges Roh-Secret. Heute: Roh-Secret nach Allow; TTL holt eine Kopie nicht zurück |

Drei Muster, die der Plan abdeckt:

1. **Autofill ist das Produkt.** Ohne zuverlässiges Fill ist alles andere Marketing.
2. **Preis + Komplexität** treiben Wechsel. Wer bloatet, verliert.
3. **Maschinen-Zugang** ist das nächste Schlachtfeld — persönlich, lokal, ehrlich. Nicht Enterprise-SaaS.

Ist-Claims bleiben in [`positioning.md`](positioning.md) und [`comparison.md`](comparison.md). Diese Tabelle ist **Planbegründung**, keine Scorecard.

---

## Zukunftssichere Architektur

Eine Schicht, drei Konsumenten. Agent-Zugang wird später kein zweites Produkt.

```text
                 ┌─────────────────────────┐
                 │  Credential Engine      │
                 │  Field Intelligence     │
                 │  Provider (Domain≠Name) │
                 │  Vault (ZK, Device)     │
                 └────────────┬─────────────┘
           ┌───────────────┼───────────────┐
           ▼                 ▼                 ▼
        Mensch              App              Agent
     Autofill/Import     (später)        Allow/Deny + TTL
```

Website bekommt **nie** den Vault. FastAPI sieht **nie** Klartext. Unknown Agent = DENY.

---

## Wo der Code heute steht (ehrlich)

| Baustein | Stand |
|---|---|
| Tresor, Crypto, Hard-Revoke, CAS | auf `main` — **nicht anfassen** |
| Desktop (Tauri) | auf `main` |
| Browser-Karten + Chrome/Firefox-Import + Review | auf `main` — [`browser-sync.md`](browser-sync.md) |
| Provider-Resolver (Domain ≠ Provider, Confidence) | `@4allpass/providers` — [`provider-resolution.md`](provider-resolution.md) |
| Extension Chromium + Firefox + Safari-Wrapper | auf `main` — Field Intelligence + Safe Fill + Provider-Match (`autofill-v1.md`) |
| Access-Policy, Broker, Allow/Deny | auf `main`, **nicht** erster Bildschirm |
| Apple-Notarisierung | CI `#111`, **pausiert** (~99 USD/Jahr, [#112](https://github.com/landjunge/4AllPass/issues/112)) |
| Terminal-Install | `scripts/install.sh` + rolling Tag `desktop` + SHA-256. Auf diesem Intel-Mac: Befehl → Fenster (2026-08-24). Vault unangetastet. |

---

## Prioritäten

### P0 — Reliability (jetzt)

Was ein Fremder merkt: App auf, Tresor, Browser erkannt, Import bestätigt.

**Konto schon da:** `POST /auth/register` → **409**. Nicht nochmal anlegen. Entweder **Anmelden** oder das Konto **erst löschen** (sonst Konflikt). Kein stilles Load-failed. Das ist First-Run-Ehrlichkeit, kein Cloud-Feature.

- Desktop startet (ad-hoc: Rechtsklick / Terminal-Install [`install-terminal.md`](install-terminal.md)).
- First Run: Tresor + Recovery-Kit, keine Lügen.
- Import: Kopie der Browser-DB → Review **ohne Passwort** → Confirm → `saveEntries`. Nie still, nie Live-DB schreiben.
- Provider: exact / subdomain / login-domain / unknown. `evilgithub.com` ist nicht GitHub. Origin bleibt Trust-Grenze.

### P1 — Autofill als Produkt (Code auf `main`)

Die Extension ist der **Ausführungsarm**, nicht das Produkt. Ziel: **Credential Interaction Engine** — eine Schicht für Import, Autofill und später Agenten.

**Spec (verbindlich):** [`autofill-v1.md`](autofill-v1.md).

V1 (bauen, nicht alles auf einmal):

```text
Seite → Field Intelligence → Login-Modell → Provider → Vault-Match
     → Safe Fill (native → controlled) → Verify (lokal, keine Secrets)
```

Bestehendes [`extension/src/fill.ts`](../extension/src/fill.ts) ist der Startpunkt, kein zweites Engine.

**Field Intelligence (Spec-Tokens zuerst):** siehe Tabelle in [`autofill-v1.md`](autofill-v1.md) §3. Kurz:

| Autocomplete-Token | Aktion | Confidence |
|---|---|---|
| `username` | Fill als Username | 0.98 |
| `email` | Fill als Username | 0.96 |
| `current-password` | Fill als Passwort | 0.98 |
| `new-password` | skip (Signup) | 0 |
| `one-time-code` / `webauthn` | skip in V1 | 0 |
| `off` | Token ignorieren, Heuristik | — |
| `name` / `given-name` / `cc-*` / Adresse | kein Username | 0 |

Nicht raten unter Confidence **0,70**. Nicht `value = password` als einzige Strategie. `webauthn` als Suffix ignorieren (Passkeys später).

**Safe Fill:** native → controlled → Verify lokal. Assist ist P1b.

**Verify-Response:** `{ ok, fields, mode, reason? }` — niemals Username oder Passwort zurück oder loggen.

Danach, nicht vorher: Multi-Step, Shadow DOM, iframe, Diagnostics, Assisted Fill.

Passkeys/OTP/SSO **nach** stabilem Password-Autofill. Passkeys nicht selbst simulieren.

### P1b — Diagnostics / Assisted

- [x] Misserfolg erklärt Felder (erkannt / gefüllt / Ergebnis), lokal, keine Secrets.
- [x] Assisted Fill bei Confidence < 0.70 (expliziter Klick, kein Auto-Write, kein Suchfeld allein).
- [ ] Shadow DOM / iframe / Multi-Step — nicht in diesem Slice.

### P2 — Agent Access (vorhanden, polish später)

- [x] Why an jeder Entscheidung (`explainAccess`, DE+EN, keine Secrets).
- [x] Simulator = Access-Tab-Demo (dieselbe Policy wie der Broker, nicht FastAPI).
- [x] Security-Status auf dem Access-Tab (Loopback, Origin 403, unknown DENY, kein Auto-Handoff).
- Access ist nicht der erste Bildschirm. Unknown = DENY. **Current v1:** human-approved `handoff: "raw_secret"`. TTL limits future handoffs, not a copied credential. Mediated access is later.

### P3 — Passkeys / OTP (bewusst spät)

- [x] TOTP am Vault-Eintrag (RFC 6238 HMAC-SHA-1, otpauth-Paste). Secret nur im verschlüsselten Entry. FastAPI sieht es nicht. Kein Fake-Authenticator.
- [ ] Passkey-Store / Conditional UI — später, echte Platform-APIs, nicht simulieren.

---

## Was wir nicht tun

Haltung: [`product-philosophy.md`](product-philosophy.md) — Produkt zuerst, Kern frei, Sicherheit und Eigentum nicht verkaufen. Kein Monetarisierungsplan in dieser Datei.

Kein Core-Rewrite. Kein zweites Tauri. Connection/Capability-UI nicht bauen, bis ausdrücklich gesagt. Keine 500 Provider. Kein Browser-Zurückschreiben. Kein Safari-Keychain / Windows / Linux-Import, bis Chrome+Firefox-Import von einem Fremden getestet ist. Kein MCP, kein n8n-Marketplace, **kein verpflichtender Cloud-Dienst**, **kein zweites Cloud-Protokoll**, kein S3/WebDAV-Picker, kein Enterprise, keine KI im Resolver. Kein Passkey-Store jetzt. Keine Launch-Posts vor P0+P1. Modell: [`vault-storage.md`](vault-storage.md).

**Eigener VServer ist erlaubt** als Platzierung (Mode B, gleiches `/api/v1`). Das ist **Cloud-Simulation / Self-host**, kein „Cloud Password Manager“ und kein Hosted-SKU. Domain: `4allpass.netzwerkpunkt.de` — nicht 4allpass.net.

**Mobile** ist im Plan **danach**: erstes Gerät-Telefon desselben Tresors ([`ADR-009`](architecture/adr/ADR-009-mobile-client.md)). 0 % App-Code, bis Desktop-First-Run + VServer-Sync stehen. Kein zweites Crypto, kein zweites Tauri.

Langfristige Vision (nicht implementieren): [`architecture/future-architecture.md`](architecture/future-architecture.md). Check: [`architecture/future-compatibility-check.md`](architecture/future-compatibility-check.md).

**Team Mode** ist als Review spezifiziert ([`team-mode.md`](team-mode.md), [`team-roadmap.md`](team-roadmap.md)) und **steht nicht in dieser Code-Reihenfolge**. Kein PAM, kein Admin-Zugriff auf Employee-Vaults, kein Implementieren, bis das Review angenommen ist.

---

## Reihenfolge (gesperrt)

```text
P0/P1 implementation substantially complete
 → external usability validation (Fremder Mac, #120)
 → remaining edge cases only after evidence
     P2  Agent UX (Why, Simulator) — Code existiert, First Screen nicht
     P3  Passkeys / OTP — TOTP auf main; Passkey-Store später
```

Apple Doppelklick (Phase A unten) bleibt **Geld-Blocker**, parallel nicht als Ausrede für Feature-Flut.

---

## Leitlinie für den Nutzer

```text
Install → Import → Autofill → fertig
```

Under the hood: Crypto, Provider Intelligence, Policy. Der Mensch muss die Architektur nicht kennen.

**Why:** „Ich öffne eine Login-Seite, 4AllPass erledigt den Login.“  
**Später:** „Mein Agent bekommt trotzdem nicht einfach das Passwort.“

---

## Phase A — Doppelklick (Apple, pausiert)

**Status:** in Arbeit / **pausiert**. CI auf `main` (`#111`). Blocker: Apple Developer ~99 USD/Jahr, nicht leistbar. Kein kostenloser Notarisierungs-Weg. Releases **ad-hoc**.

1. ~~Signing-CI mergen~~ — `#111`.
2. Secrets laut [`distribution.md`](distribution.md), wenn das Abo geht.
3. Tag `v0.1.2` → notariertes DMG.
4. Test auf **fremdem** Mac: Doppelklick.

Bis dahin: Terminal-Install [`install-terminal.md`](install-terminal.md) / `scripts/install.sh`, Rechtsklick → Öffnen.

### First Run / Uninstall (Phase B, Texte)

Unlock = Tresor-Passwort. PRF in der Webview **unbewiesen**. Recovery-Kit nicht überspringbar. Uninstall löscht **nicht** still den Vault (`Application Support` / `%APPDATA%` / `.local/share`).

Sichtbarkeit (Phase C) erst nach P0+P1. Nicht auto-publishen.

---

## Definition of Done

Sicherheit:

- [x] FastAPI mintet keine Tokens. (halten)
- [x] README sagt die Wahrheit zu Notarisierung, PRF, Autofill (Demo + GitHub-förmige Fixture).

P0:

- [x] Dieser Intel-Mac: `scripts/install.sh` → Fenster, Vault bleibt.
- [x] Import-Review: Host + Username, nie Passwort (Playwright `import-review` Datei-CSV, `browser-cards-import` zwei gemockte Chrome-Profile). Browser-Karten + Keychain auf einem **fremden** Mac bleibt ein menschlicher Check.
- [ ] Fremder Mac: App auf, Tresor, Browser-Karten, derselbe Review. **2026-08-26 übersprungen (Besucher kommt die Tage), nicht als erledigt.** Checkliste: [`freeze.md`](freeze.md).
- [x] `evilgithub.com` wird nicht zu GitHub. (`packages/providers` + Extension-Match-Tests)

P1:

- [x] Login ohne Copy-Paste auf der Demo-Seite (`test-login.html`, Playwright `autofill-local`).
- [x] GitHub-förmiges Login ohne Copy-Paste — ein Formular (`test-login-github.html`, Playwright `autofill-local`). `webauthn`-Suffix ignoriert. Split-Seiten bleiben Unit-Tests.
- [x] Live `github.com/login` ein Fill, kein Submit (opt-in `LIVE_GITHUB=1`, kein CI). Kein Multi-Step-Engine.
- [x] Misserfolg erklärt erkannt / gefüllt / Ergebnis, keine Secrets.

Installation (Apple, wenn leistbar):

- [ ] Fremder Mac: Doppelklick, kein Terminal.

Recovery:

- [x] Copy: ohne Kit / zweites Gerät kein Zurück (Create, Unlock, Emergency Kit, Settings). Kein Server-Reset.

---

## Nächster Schritt (genau einer)

**Code dieser Reihenfolge ist auf `main`.** Install, Import-Review (CI), Autofill V1, Access Allow/Deny, TOTP, Freeze #2, UI eine Frage pro Screen.

Was **kein Code** mehr ist (P0 menschlich):

1. [#120](https://github.com/landjunge/4AllPass/issues/120) — Besucher mit **fremdem** Mac (übersprungen, nicht erledigt).
2. [#112](https://github.com/landjunge/4AllPass/issues/112) — Apple ~99 USD/Jahr für Doppelklick / `v0.1.2`.
3. [#38](https://github.com/landjunge/4AllPass/issues/38) — unabhängiges Dritt-Audit.

---

## Danach — eigener VServer und Mobile (Plan, nicht jetzt bauen)

Eigener VServer ist da. Deshalb darf der Plan **Cloud-Simulation** und **Mobile** enthalten, ohne ein Cloud-Produkt zu werden.

### Cloud-Simulation (VServer)

Dasselbe wie heute Self-host: FastAPI lagert **nur Chiffretext**. Client verschlüsselt. CAS 409, Pin, Recovery unabhängig vom Server. Raus ohne Lock-in.

| Ist | Ist nicht |
|---|---|
| Desktop + später Phone gegen **einen** Server unter eurer Kontrolle | Cloud Edition / zweites Protokoll |
| `4allpass.netzwerkpunkt.de` (oder ein Pfad darauf) als Storage-URL | 4allpass.net |
| Beweis: zweites Gerät öffnet denselben Tresor | S3-Picker, Managed-SKU, Website = Vault |

Reihenfolge: Desktop A lokal ist auf `main`. Mode B: Client-Feld **Eigener Server** + `deploy/LAYOUT.md` (`vault.4allpass.netzwerkpunkt.de`, nicht die Landing). DNS/SSH auf dem VPS sind noch Host-Arbeit. Kein Hosted-Billing, kein `ProviderEncryptionKey`.

### Mobile (nach VServer-Sync)

Phone = weiteres **Gerät** desselben Tresors. Gleiche Snapshots, gleiches Recovery-Kit, unknown = DENY. PWA auf dem Handy ist erlaubt, bis native Autofill sich lohnt. Native iOS/Android erst, wenn Desktop ↔ VServer ↔ zweites Gerät steht.

Nicht: Fork von `packages/crypto`. Nicht: zweites Tauri. Nicht: Website bekommt den Vault.

### Konto schon registriert (First-Run, kann Slice 2 sein)

Wenn die E-Mail schon da ist: **nicht** nochmal `register`. UI: *Schon ein Konto — anmelden. Neu nur nach Löschen.* Server bleibt 409. Konto löschen ist **Account**-Löschen (Storage), nicht Vault-Reset: ohne Passwort/Kit bleibt der Tresor zu.

Tester-Notiz: [`freeze.md`](freeze.md). Später im selben Plan, nicht jetzt: Shadow DOM, Passkey-Store, Launch-Posts, Connection/Capability, Team Mode, MAIP-Implementierung, Hosted-SKU.

Index: [`README.md`](README.md). Vision (not this sequence): [`architecture/future-architecture.md`](architecture/future-architecture.md).

**Nicht jetzt:** Team Mode, 50 Provider, Safari-Import, Launch-Post, Passkey-Store, Multi-Step/Shadow-DOM/iframe.

**Geld:** Apple weiter pausiert ([#112](https://github.com/landjunge/4AllPass/issues/112)).
