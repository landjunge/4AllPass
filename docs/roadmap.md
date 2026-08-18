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

---

## Aktueller Stand

- Crypto-Protokoll und Reference Implementation (`packages/crypto`) sind weit fortgeschritten
- Starke Specs vorhanden (crypto-protocol, webauthn-prf, vault-revision, threat-model)
- Backend: DB-Schema komplett; **Security Boundary v1** steht (Auth, Sessions,
  Vault-Ownership, Device-Autorisierung) — siehe `backend-security-boundary.md`.
  Es fehlt der Snapshot-Sync (`vault-revision.md` §4.1) und Rate Limiting.
- Frontend: Scaffold mit Account-Login und Lock-Screen; Vault-Unlock noch nicht
  an ein Backend angebunden
- Noch keine Extension

Die Crypto-Basis ist inzwischen gut genug, dass man aufhören kann, an der Architektur zu zweifeln. Ab hier entscheiden Umsetzung und UX.

---

## Phasen

### Phase 1 – Crypto Core Freeze (aktuell)

Ziel: Den Crypto-Core stabil und auditierbar machen.

1. Adversarial Review des gesamten `packages/crypto`
2. `schemaVersion` + `cryptoVersion` direkt im `EncryptedEntry` speichern
3. Kanonische Kodierung von `credentialId` und `rpId` festlegen
4. Vollständige PRF Known-Answer-Tests
5. Side-Channel- / Timing-Review

### Phase 2 – Minimales Backend

- FastAPI + PostgreSQL ✓
- Basis-Account-System inkl. Sessions und Autorisierung ✓ (ohne Social Login)
- Snapshot-Modell mit Revisionen — Schema ✓, Commit/CAS-Endpunkte offen
- Device-Envelope-Verwaltung — Lesepfad ✓, Registrierung offen
- Rate Limiting auf den Auth-Endpunkten offen

### Phase 3 – Erster nutzbarer Client

- PWA
- Master-Password + WebAuthn-Unlock
- Grundlegendes Vault (CRUD)
- Device-Management (anzeigen + revoken)

### Phase 4 – Alltagsfähigkeit

- Browser Extension (zuerst Chromium)
- Autofill
- Import (Bitwarden / 1Password / KeePass)
- Recovery-Flow
- Offline-Fähigkeit

### Phase 5 – Reife

- Externes Security Audit
- TOTP
- Selektiv Sharing
- Bessere UX & Accessibility
- Mobile-Optimierung

---

## Bewusst später

- Organisationen / Teams
- Social Login
- Native Apps
- Passkey-Store als eigenes Feature
- Komplexe Sharing-Modelle

---

## Leitprinzip

Zuerst den Kern spürbar vertrauenswürdiger und klarer machen als „noch ein Self-hosted Bitwarden“.
Die Device-Centric-Architektur ist die eigentliche Chance von 4AllPass.
