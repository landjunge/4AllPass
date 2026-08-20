# 4AllPass Roadmap

## Produkt-Positionierung

4AllPass ist **kein besserer Bitwarden**.

Es ist ein **device-centric, self-hosted Zero-Knowledge Password Manager**.

Kernversprechen:

> Deine Geräte besitzen deinen Vault — kryptografisch, nicht nur organisatorisch.

Differenzierung:

- Echte kryptografische Gerätebindung (WebAuthn PRF → DWK → DK → VK)
- Saubere Revocation + Vault-Key-Rotation
- Vollständig offenes Crypto-Protokoll
- Self-Hosting ohne Vertrauensannahme in den Server

Ausführlich: [`positioning.md`](positioning.md), [`comparison.md`](comparison.md), [`development-plan.md`](development-plan.md).

---

## Aktueller Stand (2026-08-20)

Erledigt:

- Crypto-Protokoll und Reference Implementation (`packages/crypto`) inkl. Envelope-Property-Tests
- Specs: crypto-protocol, webauthn-prf, vault-revision, threat-model, adversarial-review, security-boundary
- Backend: FastAPI + PostgreSQL + Redis, Account-Sessions, Ownership-404, Snapshot-CAS, opaque Envelopes
- PWA: Account, Vault anlegen, Master-Passwort-Unlock, WebAuthn-Unlock, Recovery Kit, Device-Panel, Hard-Revoke, Bitwarden/1Password/KeePass/CSV-Import, Offline-Snapshot-Cache
- Chromium MV3 Autofill (`extension/`)
- Docker Compose für Postgres + Redis + Backend

Offen (ehrlich):

- Selective-Sharing-UI (Crypto-Modell da, PWA nicht verdrahtet)
- Native iOS/Android Autofill; iOS Safari Web Extension
- Post-Quantum: Konzept in `docs/post-quantum-roadmap.md` (kein Code)
- Kein unabhängiges Drittaudit (`docs/audit-scope.md` ist die Karte)

Erledigt seit diesem Datum: Hard-Revoke in der PWA, DK-Mirror-CAS, server-issued Challenges, Chromium-Autofill-MVP, Bitwarden/CSV-Import, CONTRIBUTING.

Die Crypto-Basis ist gut genug, um nicht weiter an der Architektur zu zweifeln. Ab hier entscheiden Verdrahtung, UX und Ehrlichkeit der Claims.

---

## Phasen

### Phase 1 – Crypto Core Freeze

Ziel: Den Crypto-Core stabil und auditierbar machen.

1. Adversarial Review von `packages/crypto` — weitgehend erledigt
2. `schemaVersion` + `cryptoVersion` im `EncryptedEntry`
3. Kanonische Kodierung von `credentialId` und `rpId`
4. PRF Known-Answer-Tests — vorhanden (`docs/test-vectors/device-prf-v1.json`)
5. Side-Channel- / Timing-Review — bleibt Audit-Thema

### Phase 2 – Minimales Backend — erledigt

- FastAPI + PostgreSQL
- Snapshot-Modell mit Revisionen
- Device-Envelope-Verwaltung
- Basis-Account-System (ohne Social Login)

### Phase 3 – Erster nutzbarer Client — erledigt (roh)

- PWA
- Master-Password + WebAuthn-Unlock
- Grundlegendes Vault (CRUD)
- Device-Management (anzeigen + metadata-revoke)

### Phase 4 – Alltagsfähigkeit

Reihenfolge: Hard-Revoke in der PWA zuerst, dann:

- Browser Extension (zuerst Chromium)
- Autofill
- Import (Bitwarden / 1Password / KeePass)
- Recovery-Flow UX (Download/Druck, Copy ohne Jargon)
- Offline-Fähigkeit

### Phase 5 – Reife

- Externes Security Audit (`docs/audit-scope.md`)
- TOTP
- Selektiv Sharing
- Bessere UX & Accessibility
- Mobile-Optimierung

---

## Bewusst später

- Organisationen / Teams
- Social Login als Crypto-Faktor
- Native Apps
- Passkey-Store als eigenes Feature
- Komplexe Sharing-Modelle
- **Provider & Service Management** (Konzept: [`provider-service-vision.md`](provider-service-vision.md), `#65`) — strukturierte Infrastruktur + Credentials im Ciphertext, kein API-Gateway, kein Server-Graph

---

## Leitprinzip

Zuerst den Kern spürbar vertrauenswürdiger und klarer machen als „noch ein Self-hosted Bitwarden“.
Die Device-Centric-Architektur ist die eigentliche Chance von 4AllPass.
