# Autofill V1 — Credential Interaction Engine

**Status:** verbindlich für P1. Field Intelligence, Safe Fill, Probe, Provider-Match, Assist auf `main`. Shadow-DOM/Multi-Step/iframe nicht in V1.  
**Stand:** 2026-08-24  
**Plan:** [`product-maturity.md`](product-maturity.md)  
**Install/Build der Extension:** [`autofill-extension.md`](autofill-extension.md)  
**Provider:** [`provider-resolution.md`](provider-resolution.md)

Startpunkt: [`extension/src/fill.ts`](../extension/src/fill.ts), [`content.ts`](../extension/src/content.ts), [`match.ts`](../extension/src/match.ts).  
Kein zweites Engine. Kein neues Paket.

---

## 1. Invarianten (nie verletzen)

1. Die Website bekommt **nie** den Vault — nur Werte in konkrete Felder.
2. FastAPI sieht **nie** Klartext, Fill-Ergebnisse oder Field-Maps.
3. Verify und Logs enthalten **keine** Secrets (kein Username, kein Passwort, kein OTP).
4. Unter Confidence **0,70** kein Auto-Fill. Assist füllt diese Felder nur nach Klick „Trotzdem füllen / Fill anyway“. Nie ein nacktes Suchfeld allein.
5. `new-password` / Signup wird nicht als Login gefüllt — auch nicht der Username.
6. Origin der Seite ist die Trust-Grenze. `evilgithub.com` ≠ GitHub.
7. Passkeys nicht simulieren. `autocomplete`‑Suffix `webauthn` ignorieren (P3).

---

## 2. Pipeline

```text
Page (origin)
  → Field Intelligence     fill.ts  (DOM-frei)
  → Login-Modell           threshold 0.70
  → Provider + Vault-Match @4allpass/providers + match.ts
  → Safe Fill              content.ts  native → controlled
  → Verify                 lokal, keine Secrets
```

Trigger (unverändert): Popup **Diese Seite füllen / Fill this page**, `Ctrl+Shift+L` / `⌘⇧L`, Kontextmenü.

Desktop-Unlock: `POST /auth/local` mintet nur eine **Storage-Session**. Unwrap des Tresors bleibt lokal unter dem Tresor-Passwort. FastAPI sieht den Vault-Key nicht. E-mail + Konto-Passwort bleiben für das Server-Profil.  
Kein stilles Fill beim Laden der Seite in V1 (das ist der Bitwarden-Default-Streit). Explizite Nutzeraktion.

**GitHub live** (`github.com/login`): Fixture in `fill.test.ts` ist ein Formular (Username + `current-password`; Suffix `webauthn` ignoriert). Username-only / Passwort-only / OTP-Seiten bleiben supported. Das ist **kein** Multi-Step-Engine. Live-Seite bleibt in diesem Slice ein manueller Check.

---

## 3. Field Intelligence (`fill.ts`)

DOM-frei. Das Content-Script mapped echte Inputs auf `InputLike`.

```ts
export const FILL_CONFIDENCE_THRESHOLD = 0.7;

export interface InputLike {
  type: string;
  name: string;
  id: string;
  autocomplete: string;      // raw attribute, space-separated
  placeholder?: string;
  ariaLabel?: string;
  labelText?: string;        // <label for> / wrapping label
  readonly?: boolean;
  disabled?: boolean;
}
```

`autocomplete` parsen: lowercase, split `/[\s,]+/`.  
Field-Token ist das **erste** WHATWG-Feld in der Liste. Prefixes `section-*`, `shipping`/`billing`, `home`/`work`/`mobile` ignorieren. Trailing `webauthn` ignorieren.

### 3.1 Spec-Tokens (gewinnen immer)

Quelle: [WHATWG autofill](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill).

| Token | Rolle | Score | Aktion |
|---|---|---:|---|
| `username` | username | 0.98 | Fill |
| `email` | email | 0.96 | Fill als Username |
| `current-password` | password | 0.98 | Fill |
| `password` | password | 0.92 | kein Spec-Token, aber häufig — Fill |
| `new-password` | — | 0 | **skip** (Signup / Change) |
| `one-time-code` | otp | 0.98 | P3: Fill wenn der Eintrag ein TOTP-Secret hat |
| `webauthn` | — | 0 | skip (kein Feld, nur Suffix) |
| `off` | — | — | Token ignorieren, andere Signale nutzen |
| `on` | — | — | ignorieren |
| `name`, `given-name`, `family-name`, `nickname` | — | 0 | kein Username |
| `cc-*`, `address-*`, `postal-code`, `country` | — | 0 | skip |
| `tel`, `tel-*` | — | 0 | skip V1 |

Autocomplete schlägt `name`/`id`/`placeholder`. Ein Feld mit `autocomplete="given-name"` wird **nicht** als Login-Username genommen, auch wenn `name="user"`.

### 3.2 Heuristik (nur wenn kein Spec-Token)

Reihenfolge, nicht addieren über 1.0. Höchstes passendes Signal zählt.

**Username** (nicht `type=password` / `hidden`; nicht readonly/disabled):

| Signal | Score |
|---|---:|
| `type=email` | 0.90 |
| `name`/`id`/`label`/`placeholder` ≈ `username`/`login`/`acct`/`account` ( `_` / `-` zählen als Wortgrenze: `login_field`) | 0.82 |
| dasselbe ≈ `email`/`e-mail`/`mail` | 0.80 |
| nacktes `type=text`/`tel`/`""` ohne Signal | 0.45 |

**Password** (`type=password` Pflicht):

| Signal | Score |
|---|---:|
| Token `new-password` **oder** `name`/`id`/`label` ≈ `new`/`confirm`/`repeat`/`retype` | 0 — skip |
| Token `current-password` | 0.98 |
| Token `password` | 0.92 |
| `name`/`id`/`label` ≈ `pass`/`password`/`pwd`/`passwd` | 0.80 |
| nur `type=password` | 0.72 |

0.45 liegt unter dem Threshold — kein Auto-Fill nur wegen „erster Text-Input“.

### 3.3 Login-Modell

```ts
export interface ScoredField {
  input: InputLike;
  role: "username" | "email" | "password";
  confidence: number;
  reasons: string[];   // maschinenlesbar, keine Werte aus der Seite
}

export interface LoginModel {
  username: ScoredField | null;
  password: ScoredField | null;
  confidence: number;  // min der gesetzten Felder, sonst 0
  eligible: boolean;   // confidence >= 0.70 && (username || password)
}
```

- Pro Rolle das höchst bewertete Feld.
- `eligible === false` → kein Auto-Write. P1b darf Assist anbieten.
- Nur Username ohne Passwort (z. B. erste Stufe GitHub): Fill erlaubt, wenn `username.confidence >= 0.70`.
- Signup (`new-password` vorhanden, kein `current-password`): `eligible === false`, kein Username-Fill.

**Kompat:** `pickUsername` / `pickPassword` bleiben als Wrapper mit Threshold `0`, damit bestehende Tests grün bleiben. **Fill-Pfad** nutzt nur `buildLoginModel` mit Default-Threshold 0.70.

---

## 4. Provider + Vault-Match

Gleiche Regeln wie Import. Nicht `hostname.endsWith("github.com")`.
Host aus `URL.hostname`: `github.com@evil.com` ist `evil.com`; IDN-Homographen sind Punycode, nicht GitHub.

Erlaubt:

- exact host (ohne führendes `www.`)
- `pageHost === entryHost` oder (`entryHost` enthält `.` und `pageHost.endsWith("." + entryHost)`). TLD-only (`com`) suffix-matched nicht.
- known-login-domain aus `@4allpass/providers` (z. B. `account.microsoft.com` → `login.microsoftonline.com` bei Confidence ≥ 0.95)
- URL-loser Eintrag mit `providerId`, wenn die Seite denselben Provider ≥ 0.95 auflöst

Verboten:

- `evilgithub.com` als GitHub
- `providerId`-Tag auf einer fremden URL (`https://contoso.example` + `microsoft`, `https://evilgithub.com` + `github`) als Brücke zur Login-Domain
- Raten eines Provider-Ids unter Confidence 0.95 ohne Bestätigung (Import). Für Fill: gespeicherte URL gewinnt vor dem Tag.

Mehrere Treffer: Popup/Menü zeigt Titel + Username-Maske (`j***@x.de` oder Länge), **nicht** das Passwort. Ein Treffer darf direkt gefüllt werden nach explizitem Trigger.

`match.ts` bleibt dünn. Provider-Resolver nicht neu erfinden.

---

## 5. Safe Fill (`content.ts`)

Nur sichtbare, editierbare Felder: nicht `hidden`, nicht `disabled`, nicht `readonly`, `display !== none`, `visibility !== hidden`. Kein Fill in `type=hidden`.

```ts
type FillMode = "native" | "controlled" | "failed";

function safeFill(input: HTMLInputElement, value: string): FillMode
```

Reihenfolge **pro Feld**:

1. **native** — `focus()`, dann `InputEvent("input", { bubbles: true, inputType: "insertText", data: value })`. Optional `document.execCommand("insertText")` nur als zweiter nativer Versuch, nie als einzige Strategie.
2. **controlled** — Prototype-`value`-Setter (React/Vue) + `input`/`change` Events (bubbles). Das ist der heutige `setValue`-Pfad, bleibt Fallback.
3. Erfolg = `input.value === value` nach dem Versuch.
4. **failed** — nicht raten, nicht in andere Felder schreiben.

Nie allein `input.value = password` ohne Setter + Events.

Kein Submit klicken in V1. Kein iframe/Shadow-DOM in V1 (P1b+).

---

## 6. Verify (lokal, keine Secrets)

```ts
interface FillResult {
  ok: boolean;
  fields: ("username" | "password")[];
  mode: FillMode | "skipped";
  reason?: "locked" | "low-confidence" | "no-match" | "no-fields" | "verify-mismatch" | "signup";
  confidence?: number;   // 0..1, keine Roh-Strings aus der Seite
}
```

- `ok` nur wenn jedes versuchte Feld `value === expected`.
- Background speichert `FillResult` höchstens im Speicher der Session, nie auf Disk, nie im Log.
- Content-Script schickt **nicht** Username/Password zurück.

---

## 7. Nachrichten

Unverändert in der Richtung Background → Content (Secrets müssen fürs Fill rüber):

```text
{ type: "fill-form", username, password }
```

Antwort V1:

```text
FillResult   // nie username/password
```

Session-Lock (`idle-lock.ts`) bleibt: bei Lock Secrets im Background zeroizen. Fill bei gelocktem Vault → `{ ok: false, reason: "locked" }`.

---

## 8. Mapping auf Dateien

| Datei | V1-Auftrag |
|---|---|
| `extension/src/fill.ts` | `InputLike` erweitern, `score*` / `buildLoginModel`, Wrapper `pick*` |
| `extension/src/content.ts` | `describe()` mit label/placeholder/aria; `safeFill`; `FillResult` |
| `extension/src/match.ts` | Suffix-Regel; Provider-Brücke nur wenn die gespeicherte URL denselben Provider ≥ 0.95 auflöst (Tag allein überschreibt keine fremde URL). Popup-Liste ohne Passwort (`publicPicks`). |
| `extension/src/background.ts` | FillResult entgegennehmen; bei `!eligible` nicht fill-form senden |
| `extension/test/fill.test.ts` | Spec-Tokens, Threshold, Signup-Skip, given-name ≠ username |

---

## 9. Tests (Minimum)

Bestehende drei Tests bleiben grün (`pick*` Threshold 0).

Zusätzlich:

- `autocomplete=username` + `current-password` → eligible, scores ≥ 0.95
- `autocomplete=new-password` only → password null, nicht fill
- `autocomplete=given-name` neben `type=password` → given-name nicht als username
- `evilgithub.com` vs Eintrag `github.com` → kein Match
- `https://evilgithub.com` + `providerId: github` auf github.com → kein Match
- `https://contoso.example` + `providerId: microsoft` auf login.microsoftonline.com → kein Match
- URL-loser `providerId: microsoft` auf login.microsoftonline.com → Match
- `login.github.com` vs `github.com` → Match (Suffix `.{host}`)
- schwacher `type=text name=q` allein → nicht eligible
- `type=password` ohne autocomplete → score ≥ 0.70, eligible wenn Passwort-Feld da

Kein Test darf Passwörter in Assertions loggen, außer feste Fixtures (`"secret"`) in Unit-Tests.

---

## 10. Nicht in V1

Multi-Step, iframe, Shadow DOM, contenteditable, `inputmode`, Captcha, Passkeys, TOTP-Fill, Conditional UI, stilles On-Load-Fill, Browser-`Login Data` zurückschreiben, iOS/Android native Autofill, Safari-Keychain-Import, 500 Provider, KI-Klassifikation.

P1b: Diagnostics + Assisted.  
P3: Passkeys / OTP — echte Platform-APIs, nicht simulieren.

---

## 11. Definition of Done (P1)

Aus [`product-maturity.md`](product-maturity.md):

- [x] Ein Login auf der Demo-Seite ohne Copy-Paste (`test-login.html`, gleichwertig für V1). GitHub live bleibt manuell.
- [x] Misserfolg erklärt erkannt / gefüllt / Ergebnis, keine Secrets.
- [x] Unit-Tests für §9 grün.
- [x] Keine Secrets in `FillResult` / Logs.
