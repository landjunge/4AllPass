# Architektur – 4AllPass

**Self-hosted Zero-Knowledge Passwort-Manager**

**Ziel**  
Ein selbst gehosteter Passwort-Manager, der unter voller Kontrolle des Nutzers steht, echte Zero-Knowledge-Sicherheit bietet und gleichzeitig modern, komfortabel und zukunftssicher ist.

---

## 1. Grundprinzipien

- **Zero-Knowledge**: Der Server sieht niemals Klartext-Passwörter oder das Master-Passwort.
- Das **Master-Passwort** ist die einzige Quelle für die Entschlüsselung (neben dem Recovery Key).
- **Biometrie** und **Social-Login** sind reine Komfort-Funktionen und ersetzen das Master-Passwort nicht.
- Selektives Sharing: Der Nutzer entscheidet pro Browser-Profil und Gerät, welche die Vault-Daten erhalten (kryptografisch über Key Envelopes).

---

## 2. Crypto (Authoritative)

Die vollständige und verbindliche kryptografische Spezifikation steht in:

→ **[docs/crypto-protocol.md](crypto-protocol.md)** (Crypto Protocol v1)

Zusammenfassung der wichtigsten Punkte:
- Vault Key ist **immer pure random** (nie aus dem Master-Passwort abgeleitet)
- Key Envelopes (Master / Device / Recovery), jeder mit authentifizierter `vaultKeyVersion`
- AES-256-GCM mit Pflicht-AAD und library-generierten Nonces
- Snapshot-Manifest: `revision` ist kryptografisch gebunden, nicht nur Server-Metadatum
- Vault Key Rotation bei Hard-Revocation, Device-Key Rotation über `deviceKeyVersion`
- Recovery Key + Emergency Kit (kein Server-Reset) → **[docs/recovery.md](recovery.md)**

Threat Model: → **[docs/threat-model.md](threat-model.md)**  
Adversarial Review des Crypto-Cores: → **[docs/adversarial-review.md](adversarial-review.md)**

---

## 3. Authentifizierung

**Authentication ≠ Vault Decryption.** The backend session proves *who is calling
the API*. It does not unwrap the Vault Key. Details:
[`backend-security-boundary.md`](backend-security-boundary.md).

### Master-Passwort
- Pflicht und zentrale Sicherheitsgrundlage
- Verlässt den Client nie

### Biometrie (WebAuthn / Passkeys)
- Pro Gerät aktivierbar
- Schützt Device Key Material (siehe crypto-protocol.md)
- Fallback immer auf Master-Passwort

### Account-Login
- E-Mail + Account-Passwort (getrennt vom Master-Passwort)
- Session: opaque server-side id in an **HttpOnly** cookie (`fourallpass_session`),
  not a JWT and not a token in `localStorage` / `sessionStorage`
- Ownership: every vault/device/snapshot route uses `get_current_user()` then
  `require_vault_owner()` — missing and foreign vaults are both `404`
- Optional later: Google-Login and „Sign in with Apple“
- Social-Login / Account-Passwort haben **keinen Einfluss** auf die Verschlüsselung

---

## 4. Geräte- und Profil-Management

- Jedes Browser-Profil und jedes Mobilgerät erhält eine eigene stabile Identität.
- Zugriff wird kryptografisch über die Existenz eines Device Envelopes gesteuert (nicht nur über ein Flag).
- Soft-Revocation: Envelope entfernen
- Hard-Revocation (bei Kompromittierungsverdacht): Vault Key Rotation + Re-Encrypt

Details: siehe crypto-protocol.md Abschnitt 7.

---

## 5. Mobile-Strategie

1. Progressive Web App (PWA) als erster Weg
2. Geräte erscheinen als Karten und können selektiv freigeschaltet werden
3. Biometrie über WebAuthn
4. Später optional native Apps

---

## 6. Technik-Stack

| Schicht          | Technologie                          |
|------------------|--------------------------------------|
| Backend          | FastAPI + PostgreSQL + Redis         |
| Frontend         | React + TypeScript                   |
| Crypto           | Gemeinsame Library (Web + Extensions)|
| Extensions       | Chromium (Manifest V3) + Firefox     |
| Deployment       | Docker + docker-compose              |
| Biometrie        | WebAuthn                             |

---

## 7. Sicherheit – Zusammenfassung

- Keine Klartext-Daten auf dem Server
- Master-Passwort wird nie übertragen
- Biometrie nur als Geräte-gebundene Komfortschicht
- Social-Login nur für den Account
- Geräte und Credentials können widerrufen werden (inkl. Key Rotation)
- Recovery über Recovery Key / Emergency Kit spezifiziert

---

## 8. Offene / spätere Punkte

- Import/Export (encrypted backup + optional plaintext mit Warnung)
- Audit-Logs
- Passwort-Generator
- Shamir Secret Sharing als erweiterte Recovery-Option

---

**Stand:** 18. August 2026  
**Crypto Protocol:** v1 (siehe crypto-protocol.md)  
**Security boundary:** v1 (siehe backend-security-boundary.md)
