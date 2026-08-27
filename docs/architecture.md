# Architektur – 4AllPass

**Status:** Shape of the product. What *runs* is [`security-boundary.md`](security-boundary.md).  
**Date:** 2026-08-28

**Der Server speichert den Tresor. Der Client besitzt den Tresor.**

Desktop is the client. Self-hosting is where sealed snapshots may live. Managed hosting is **later**, same protocol, no Cloud Edition: [`vault-storage.md`](vault-storage.md), [`vault-protocol.md`](vault-protocol.md).

Vision (do not implement from this paragraph): [`architecture/future-architecture.md`](architecture/future-architecture.md). Agents later: [`architecture/agent-access.md`](architecture/agent-access.md), [`specs/maip-v0.1.md`](specs/maip-v0.1.md). Index: [`README.md`](README.md).

**Ziel**  
Ein Tresor, der dem Nutzer gehört. Wo der *verschlüsselte* Tresor liegt, entscheidet der Nutzer (dieses Gerät, eigener Server, später optional Hosted). Zero-Knowledge bleibt: der Endpoint sieht keinen Klartext.

**Basics (2026-08-23):** Sync aller Browser und Profile — Karten, anhaken, Passwörter im Tresor. Plan: [`browser-sync.md`](browser-sync.md). Agent-Zugang ist nicht der Einstieg. Crypto-Protokoll bleibt.

---

## 1. Grundprinzipien

Haltung (kein Businessplan): [`product-philosophy.md`](product-philosophy.md). Sicherheit und Eigentum werden nicht verkauft.

- **Zero-Knowledge**: Der Vault-Endpoint sieht niemals Klartext-Passwörter oder das Master-Passwort. Hosting ändert das Protokoll nicht. Ein Tresor darf technisch **nicht** von seinem Hoster abhängen ([`vault-protocol.md`](vault-protocol.md), [`vault-storage.md`](vault-storage.md)).
- Das **Master-Passwort** ist die einzige Quelle für die Entschlüsselung (neben dem Recovery Key).
- **Biometrie** und **Social-Login** sind reine Komfort-Funktionen und ersetzen das Master-Passwort nicht.
- Gerätezugriff: Der Nutzer entscheidet pro Browser-Profil und Gerät, welche die Vault-Daten erhalten (kryptografisch über Device Envelopes).
- Item-Share in v1: portables verschlüsseltes File plus Share-Key (`docs/sharing.md`), nicht an den Device Key einer anderen Person.

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

### Master-Passwort
- Pflicht und zentrale Sicherheitsgrundlage
- Verlässt den Client nie

### Biometrie (WebAuthn / Passkeys)
- Pro Gerät aktivierbar
- Schützt Device Key Material (siehe crypto-protocol.md)
- Fallback immer auf Master-Passwort

### Account-Login
- E-Mail + Account-Passwort (getrennt vom Master-Passwort)
- Implementiert: `POST /api/v1/auth/register|login|logout`, `GET /api/v1/auth/me`
- Session: revocable Bearer-Token (Redis; Token wird gehasht gespeichert).
  Bearer is retained on purpose — see [`docs/security-boundary.md`](security-boundary.md).
- Jede Vault-/Device-/Snapshot-Route prüft Ownership (`get_owned_vault` → 404)
- Optional später: Google-Login und „Sign in with Apple"
- Social-Login hat **keinen Einfluss** auf die Verschlüsselung
- Authentication ≠ vault decryption. The account session never unwraps VK.

---

## 4. Geräte- und Profil-Management

- Jedes Browser-Profil und jedes Mobilgerät erhält eine eigene stabile Identität.
- Zugriff wird kryptografisch über die Existenz eines Device Envelopes gesteuert (nicht nur über ein Flag).
- `DELETE /devices/{id}` is **metadata-only** (`revocation: "metadata_only"`).
  Soft cryptographic revoke = PWA `revokeDevice` (DELETE, then next snapshot without
  that device envelope, same `vaultKeyVersion`).
  Hard revoke = PWA `hardRevokeDevice` (Vault Key rotation, re-encrypt, omit target,
  CAS commit, then metadata DELETE). Foreign device envelopes are not rewrapped;
  this device’s envelope is included only when its Device Key is recoverable
  locally without a WebAuthn ceremony — otherwise every device re-enrols after
  master unlock. See [`docs/security-boundary.md`](security-boundary.md) §4.
- WebAuthn credential rows are `client_asserted` until the PWA posts a
  registration/assertion the server can COSE-verify (`verification: "cose_verified"`).
  That is ceremony integrity. The server never verifies PRF output.

Details: crypto-protocol.md §7 and [`docs/security-boundary.md`](security-boundary.md).

---

## 5. Mobile-Strategie

**Regel:** Mobile ist ein Gerät des *gleichen* Vaults — kein zweites Protokoll, kein Fork von `packages/crypto`. Crypto und Snapshots bleiben plattformneutral.

1. **PWA zuerst** — der erste Weg auf dem Handy. Biometrie über WebAuthn, Geräte erscheinen als Karten und können selektiv freigeschaltet werden.
2. **Native Apps später, optional** — erst wenn PWA-Autofill nicht reicht. Gleiche Vault-API, gleiche Envelopes.
3. **Android vor iOS** — Android hat keinen Entitlement-Flaschenhals; iOS braucht Apple-Entitlement + Review.
4. **Skelette existieren nur als Vorbereitung**, nicht als Startschuss:  
   - Android: [`android-skeleton-grok-build.md`](android-skeleton-grok-build.md)  
   - iOS: [`ios-skeleton-grok-build.md`](ios-skeleton-grok-build.md)  
   Diese Docs sind *Prompt-Vorlagen* für Grok Build. Sie ersetzen **nicht** die PWA-Strategie und sind **kein** Freifahrtschein, native Apps vor PWA zu bauen.

Siehe auch: [`architecture/adr/ADR-009-mobile-client.md`](architecture/adr/ADR-009-mobile-client.md).

---

## 6. Technik-Stack

| Schicht          | Technologie                          |
|------------------|--------------------------------------|
| Vault Protocol v1 | FastAPI `/api/v1`; local SQLite **or** Postgres — same wire ([`vault-protocol.md`](vault-protocol.md)) |
| Frontend         | React + TypeScript                   |
| Crypto           | Gemeinsame Library (Web + Extensions)|
| Extensions       | Chromium (Manifest V3) + Firefox     |
| Deployment       | Local: SQLite loopback. Server: Postgres + Redis. Docker optional |
| Biometrie        | WebAuthn                             |

---

## 7. Sicherheit – Zusammenfassung

- Keine Klartext-Daten auf dem Server
- Master-Passwort wird nie übertragen
- Biometrie nur als Geräte-gebundene Komfortschicht
- Social-Login nur für den Account
- Geräte: Soft-Revoke = Metadata + Snapshot ohne Device Envelope (gleiche VK);
  Hard-Revoke = Vault-Key-Rotation in der PWA (`hardRevokeDevice`). Soft DELETE
  bleibt `metadata_only`.
- Recovery über Recovery Key / Emergency Kit spezifiziert

---

## 8. Code-Hygiene (Soll-Zustand)

> Beobachtet im Code-Review 2026-08-28. Status und Aufgaben: `ROADMAP.md` §1b.

- **`src-tauri/src/lib.rs`** ist heute ein Monolith (Prozess-Management, Sleep-Detection, Access-Prompts, Tray, HTTP-Proxy). Soll in Module zerlegt werden – prozess, sleep, prompts, tray, proxy.
- **`Cargo.toml`** pinnt nicht streng (`tauri = { version = "2" }`). Soll exakte Versionen, konsistent mit `docs/supply-chain-security.md`.
- **Sidecar-Prozess-Erkennung** nutzt rohe `ps`- / `lsof`-Aufrufe (unix-spezifisch, fragil). Soll hinter eine Plattform-Abstraktion.

Keine neuen Docs für Hygiene – alles lebt in `ROADMAP.md` §1b.

---

## 9. Offene / spätere Punkte

- Import/Export (encrypted backup + optional plaintext mit Warnung)
- Audit-Logs
- Passwort-Generator
- Shamir Secret Sharing als erweiterte Recovery-Option
- **Team Mode** — spezifiziert, nicht gebaut: [`team-mode.md`](team-mode.md). Organisation ist eine Grenze, kein PAM. Trusted Recovery = XOR-Split des **bestehenden** Recovery Key (nicht VK, nicht Shamir in MVP). Nicht implementieren, bis das Review angenommen ist.

---

**Stand:** 28. August 2026  
**Crypto Protocol:** v1 (siehe crypto-protocol.md)  
**Backend security boundary:** account session + vault ownership + race-safe snapshot CAS + honest device/WebAuthn semantics (`docs/security-boundary.md`)
