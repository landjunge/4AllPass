# Architektur – 4AllPass

**Self-hosted Zero-Knowledge Passwort-Manager**

**Ziel**  
Ein selbst gehosteter Passwort-Manager, der unter voller Kontrolle des Nutzers steht, echte Zero-Knowledge-Sicherheit bietet und gleichzeitig modern, komfortabel und zukunftssicher ist.

---

## 1. Grundprinzipien

- **Zero-Knowledge**: Der Server sieht niemals Klartext-Passwörter oder das Master-Passwort.
- Das **Master-Passwort** ist die einzige Quelle für die Entschlüsselung.
- **Biometrie** und **Social-Login** sind reine Komfort-Funktionen und ersetzen das Master-Passwort nicht.
- Selektives Sharing: Der Nutzer entscheidet pro Browser-Profil und Gerät, welche die Vault-Daten erhalten.

---

## 2. Verschlüsselung (Crypto)

### Key-Derivation
- Algorithmus: **Argon2id**
- Standard-Parameter:
  - Memory: 64 MiB (65536 KiB)
  - Iterations: 3
  - Parallelism: 4
  - Hash-Länge: 32 Byte

### Unterstützte Profile
| Profil       | Memory  | Iterations | Parallelism | Einsatz                    |
|--------------|---------|------------|-------------|----------------------------|
| Standard     | 64 MiB  | 3          | 4           | Normalfall                 |
| Balanced     | 32 MiB  | 6          | 4           | Bitwarden-ähnlich          |
| Mobile-safe  | 32 MiB  | 3          | 1           | Schwächere Geräte          |
| High         | 128 MiB | 4          | 4           | Maximale Sicherheit        |

Die Parameter werden immer zusammen mit dem Salt gespeichert, damit später ohne Datenverlust auf ein stärkeres Profil gewechselt werden kann (Re-Keying).

### Key-Wrapping
- Aus dem Master-Passwort wird ein Master-Key abgeleitet.
- Dieser verschlüsselt einen zufälligen **Vault-Key**.
- Alle Vault-Einträge werden mit dem Vault-Key (AES-256-GCM) verschlüsselt.

### Eintrags-Verschlüsselung
- AES-256-GCM
- Pro Eintrag eigener IV/Nonce
- Authenticated Encryption

---

## 3. Authentifizierung

### Master-Passwort
- Pflicht und zentrale Sicherheitsgrundlage
- Sollte eine starke Passphrase sein (keine 6-stellige PIN)
- Verlässt den Client nie

### Biometrie (WebAuthn / Passkeys)
- Pro Gerät aktivierbar
- Ablauf:
  1. Einmalig mit Master-Passwort entsperren
  2. Vault-Key mit Plattform-Authenticator (Fingerprint / Face ID / Windows Hello) wrappen
  3. Ab dann biometrisches Entsperren möglich
- Fallback immer auf Master-Passwort

### Account-Login
- E-Mail + Account-Passwort (getrennt vom Master-Passwort)
- Optional: Google-Login und „Sign in with Apple“
- Social-Login hat **keinen Einfluss** auf die Verschlüsselung

---

## 4. Geräte- und Profil-Management

- Jedes Browser-Profil und jedes Mobilgerät erhält eine eigene stabile Identität.
- In der Oberfläche erscheinen sie als **Karten**.
- Der Nutzer kann pro Karte den Sync ein- oder ausschalten.
- Nur freigeschaltete Geräte/Profile erhalten die verschlüsselten Vault-Daten.

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
- Geräte und Credentials können widerrufen werden

---

## 8. Offene / spätere Punkte

- Recovery-Strategie
- Import/Export
- Audit-Logs
- Auto-Lock
- Passwort-Generator

---

**Stand:** August 2026
