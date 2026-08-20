# 4AllPass — Entwicklungsplan (UX · Technik · Positionierung)

**Zweck:** Arbeitsauftrag in drei Achsen. Phasen sind nach Wirkung/Aufwand sortiert, nicht streng chronologisch.

**Stand im Repo (2026-08-20):** Backend (FastAPI) und PWA existieren. Crypto-Core, WebAuthn-PRF, Recovery-Kit und Snapshot-CAS sind implementiert. Es gibt **keine** Browser-Extension und **kein** Selective Sharing in der laufenden PWA. Hard-Revoke (Vault-Key-Rotation in der PWA) ist spezifiziert und in `packages/crypto` getestet, aber in der PWA noch nicht verdrahtet — offene PRs: [#15](https://github.com/landjunge/4AllPass/pull/15), [#16](https://github.com/landjunge/4AllPass/pull/16).

Engineering-Reihenfolge für **Code** (nicht überspringen): siehe [`.cursor/skills/4allpass/references/improve.md`](../.cursor/skills/4allpass/references/improve.md). Autofill, Import und Selective Sharing kommen **nach** Hard-Revoke und Recovery-UX.

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

Heute: Account- und Vault-Erstellung sind getrennte Screens; das Emergency Kit erscheint nach Vault-Erstellung (`RecoveryKitDialog`) und braucht die Checkbox. Argon2id-Profilnamen stehen noch in der Vault-Erstellung.

### A2. Autofill als Kernfeature

Browser-Extension, die über `@4allpass/crypto` clientseitig entschlüsselt. Kein zweites Protokoll. Native Autofill (iOS/Android) als Folgephase.

Akzeptanzkriterium: Login auf einer Testseite via Extension in ≤2 Klicks, ohne Copy-Paste.

**Nicht starten**, bevor Hard-Revoke in der PWA landet.

### A3. WebAuthn/Biometrie als Standard-Unlock

Nach Erstanmeldung WebAuthn (PRF) als Standard-Entsperrung vorschlagen, Passwort nur als Fallback.

Heute: Unlock-Page zeigt Biometrie bereits als Primary-Button, wenn ein Device-Unlock verfügbar ist (`UnlockPage`).

### A4. Selective Sharing sichtbar machen

„Eintrag teilen“ in 2 Klicks. **Später** — nach Hard-Revoke und Recovery-UX. Sharing ist im Crypto-Modell (Device-Envelopes) angelegt, in der PWA nicht verdrahtet.

---

## B) Technischer Stand

### B1. Unabhängiges Security-Audit vorbereiten

Deliverable: [`docs/audit-scope.md`](audit-scope.md). Die KI führt das Audit nicht selbst durch.

### B2. Reproducible Builds

Deterministischer Frontend-Build-Hash. Deliverable später: `docs/reproducible-builds.md`.

### B3. Fuzzing des Crypto-Cores

Property-based Tests (`fast-check`) für Envelope-Un/Wrapping, in CI. Ergänzt die bestehende KAT- und Adversarial-Suite.

### B4. Post-Quantum-Vorbereitung

Hybrid-KEM (z. B. X25519 + ML-KEM) als Konzept, keine Pflichtimplementierung. Deliverable später: `docs/post-quantum-roadmap.md`.

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

`CONTRIBUTING.md` und Issue-Templates, sobald der vorzeigbare Stand (Hard-Revoke + ehrliche Doku) steht.

---

## Reihenfolge

1. **B1 + B5 + C1–C3** — Fundament, kein Crypto-Risiko.
2. **Hard-Revoke in der PWA** (#15/#16 mergen oder rebasen, nicht neu schreiben).
3. **A1 + A3** — Onboarding-Copy und WebAuthn-Standard, Bausteine existieren.
4. **A2 Autofill** — sobald der Kern kryptografisch widerrufbar ist.
5. **B2, B3, B4** — technische Vertiefung.
6. **A4 + C4** — Sharing und Community.

---

## Hinweise für Agenten

- Vor jeder Code-Änderung: `packages/crypto`, `packages/webauthn`, `backend`, `frontend` respektieren, keine Parallelstrukturen.
- Zero-Knowledge: Server sieht nie Klartext oder Schlüssel. Im Zweifel Rückfrage, nicht eigenmächtig entscheiden.
- Neue krypto-relevante Änderungen brauchen KATs / Adversarial-Tests analog zu `docs/test-vectors.md`.
- `docs/` ist authoritative. Architekturänderungen im selben PR nachziehen.
- Skill: [`.cursor/skills/4allpass/SKILL.md`](../.cursor/skills/4allpass/SKILL.md).
