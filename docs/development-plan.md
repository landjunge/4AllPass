# 4AllPass — Entwicklungsplan (UX · Technik · Positionierung)

**Zweck:** Arbeitsauftrag in drei Achsen. Phasen sind nach Wirkung/Aufwand sortiert, nicht streng chronologisch.

**Stand im Repo (2026-08-20):** Backend und PWA existieren. Crypto-Core, WebAuthn-PRF, Recovery-Kit, Snapshot-CAS, Hard-Revoke, DK-Mirror-CAS, COSE-Ceremony-Verify, Chromium-/Firefox-/macOS-Safari-Autofill, Bitwarden/1Password/KeePass/CSV-Import, Envelope-Property-Tests, Reproducible Builds, Offline-Snapshot-Cache, Clipboard-Overwrite und v1 Item-Share-Files (`docs/sharing.md`) sind im Baum. Kein Live-Share an fremde Device Keys, kein iOS/Android Autofill.

Engineering-Reihenfolge für **Code** (nicht überspringen): siehe [`.cursor/skills/4allpass/references/improve.md`](../.cursor/skills/4allpass/references/improve.md). Item-Share-Files sind auf main (`docs/sharing.md`). Public-Key-Wrapping an fremde Geräte nicht starten, solange niemand danach fragt.

**Wedge (8 Wochen):** [`eight-week-agent-access.md`](eight-week-agent-access.md) — Agent credential access, 4AllPass eigenständig, Broker lokal, FastAPI ohne Tokens. Tollgate erst danach als Client. Provider-Vision `#65`, SAL `#67`, 4AP-CAP-1 `#70` bleiben die Specs darunter. Clipboard-Ingest `#59` bleibt far later. Demo: [`two-minute-demo.md`](two-minute-demo.md). Artikel: [`your-ai-agent-doesnt-need-your-api-keys.md`](your-ai-agent-doesnt-need-your-api-keys.md). Posts nicht auto-publishen.

---

## Leitprinzip

1. **Sicherheit darf nie für Einfachheit geopfert werden** (Zero-Knowledge bleibt unantastbar).
2. **Einfachheit darf nie für Feature-Reichtum geopfert werden.**
3. Differenzierung entsteht aus 1+2, nicht aus zusätzlichem Marketing-Text.
4. Keine README-/Website-Behauptung als ✅, die `docs/security-boundary.md` nicht trägt.

---

## A) UX / Einfachheit

### A1. Onboarding-Flow überarbeiten

Registrierung/Setup auf max. 3 Screens:

1. Konto anlegen (E-Mail / Account-Passwort — **nicht** das Master-Passwort).
2. Master-Passwort setzen + ein Satz, warum es nicht zurückgesetzt werden kann.
3. Recovery Key erzwungen anzeigen + Download/Druck, mit Bestätigungs-Checkbox.

Akzeptanzkriterium: Recovery-Key-Schritt ist nicht überspringbar. Kein Krypto-Jargon in der UI (`Argon2id`, `Envelope`). Copy an `docs/recovery.md` ausrichten.

Heute: Account- und Vault-Erstellung sind getrennte Screens; das Emergency Kit erscheint nach Vault-Erstellung (`RecoveryKitDialog`) und braucht die Checkbox. Copy ist Alltagsprache (`#29`); Argon2id-Profilnamen sind aus der Vault-Erstellung raus.

### A2. Autofill als Kernfeature

Browser-Extension, die über `@4allpass/crypto` clientseitig entschlüsselt. Kein zweites Protokoll. Native Autofill (iOS/Android) als Folgephase.

Akzeptanzkriterium: Login auf einer Testseite via Extension in ≤2 Klicks, ohne Copy-Paste.

Chromium **auf main** (`extension/`, `#30`): MV3, Entschlüsselung über `@4allpass/crypto`, Fill auf `frontend/public/test-login.html`, Host-Match, Shortcut/Kontextmenü. Firefox 128+ und **macOS Safari** (Xcode-Wrapper `extension/safari/`) laden dasselbe Bundle. Native iOS/Android Autofill und iOS-Safari-Extension bleiben Folgephase.

### A3. WebAuthn/Biometrie als Standard-Unlock

Nach Erstanmeldung WebAuthn (PRF) als Standard-Entsperrung vorschlagen, Passwort nur als Fallback.

Heute: Unlock-Page zeigt Biometrie bereits als Primary-Button, wenn ein Device-Unlock verfügbar ist (`UnlockPage`).

### A4. Selective Sharing sichtbar machen

„Eintrag teilen“ in 2 Klicks. v1 ist symmetrisch: **Share** baut ein portables Snapshot-File plus Share-Key (`docs/sharing.md`). Der Server sieht beides nicht. Device-Envelopes bleiben die Freigabe **eigener** Geräte (Devices-Panel). Wrapping an den Device Key einer anderen Person braucht Public-Key-Wrapping und ist später.

---

## B) Technischer Stand

### B1. Unabhängiges Security-Audit vorbereiten

Deliverable: [`docs/audit-scope.md`](audit-scope.md). Die KI führt das Audit nicht selbst durch.

### B2. Reproducible Builds

✅ [`docs/reproducible-builds.md`](reproducible-builds.md). Tree-Hash von `frontend/dist` und `extension/dist` (`scripts/hash-dist.mjs`). CI: zwei Builds, gleicher Hash (`npm run verify:reproducible`). Kein Cross-OS-Claim.

### B3. Fuzzing des Crypto-Cores

✅ `packages/crypto/test/property-envelope.test.ts` (`fast-check`, läuft in `npm test` / CI).
Device-/Recovery-Envelope, Device-Key Envelope, Entries: Roundtrip plus falscher Key / falsche Identität / Tamper. Ergänzt KATs und die Adversarial-Suite. Master-Envelopes bleiben auf dem Argon2id-Vektorpfad.

### B4. Post-Quantum-Vorbereitung

✅ [`docs/post-quantum-roadmap.md`](post-quantum-roadmap.md) — Konzept, **keine** Implementierung. v1 ist symmetrisch (AES-256-GCM, Argon2id, HKDF). Hybrid-KEM erst, wenn Public-Key-Wrapping (Sharing / Remote-Enrol) tatsächlich kommt.

### B5. CI/CD-Härtung

`npm test`, `test:webauthn`, `typecheck`, Backend-`pytest`, unabhängige Vektor-Skripte, `npm audit` / `pip-audit` in GitHub Actions.

---

## C) Positionierung

### C1. Zielgruppe

[`docs/positioning.md`](positioning.md)

### C2. Feature-Vergleich

[`docs/comparison.md`](comparison.md) — nur belegte Ist-Zustände als ✅.

### C3. Transparenz als Marke

README-Abschnitt „Why trust this?“ mit Verweisen auf Threat Model, Adversarial Review, Testvektoren, Security Boundary.

### C4. Community

`CONTRIBUTING.md` und Issue-Templates sind auf `main` (`#31`).

---

## Reihenfolge

1. **B1 + B5 + C1–C3** — ✅ `#25`
2. **Hard-Revoke in der PWA** — ✅ `#26` (DK-Mirror-CAS `#27`)
3. **A1 + A3** — ✅ `#29` (A3 war schon Primary auf der Unlock-Page)
4. **A2 Autofill (Chromium-MVP)** — ✅ `#30` (+ Live-E2E in `#29`)
5. **B2 + B3 + B4** — ✅ Reproducible Builds, Envelope-Fuzzing, PQ-Konzept (`docs/post-quantum-roadmap.md`, kein Code)
6. **A4 Sharing** — ✅ portables Share-File (`docs/sharing.md`). Live-Share an fremde Device Keys bleibt später. C4 Community ✅ `#31`

COSE-Assertion gegen die server-issued Challenge ist in diesem Stand verdrahtet (Ceremony-Integrität, kein PRF). Import (Bitwarden JSON/CSV) ist auf `main` (`#31`).

---

## Hinweise für Agenten

- Vor jeder Code-Änderung: `packages/crypto`, `packages/webauthn`, `backend`, `frontend` respektieren, keine Parallelstrukturen.
- Zero-Knowledge: Server sieht nie Klartext oder Schlüssel. Im Zweifel Rückfrage, nicht eigenmächtig entscheiden.
- Neue krypto-relevante Änderungen brauchen KATs / Adversarial-Tests analog zu `docs/test-vectors.md`.
- `docs/` ist authoritative. Architekturänderungen im selben PR nachziehen.
- Skill: [`.cursor/skills/4allpass/SKILL.md`](../.cursor/skills/4allpass/SKILL.md).
