# Architektur — Tresor in fünf Minuten

**Status:** Shape. Was *läuft*: [`security-boundary.md`](security-boundary.md).  
**Date:** 2026-08-28  
**Crypto:** [`crypto-protocol.md`](crypto-protocol.md). **Flächen:** [`ui-map.md`](ui-map.md).

**Der Client besitzt den Tresor. Der Server speichert nur Blobs.**

---

## 1. System

```
Mensch / Agent
    │
    ▼
┌─ UI ──────────────┐   React PWA / Tauri   frontend/src
│  vault desk       │   Tokens: DESIGN.md Magpie, tokens.css
└────────┬──────────┘
         │ saveEntries / copySecret
         ▼
┌─ Crypto ──────────┐   @4allpass/crypto (+ webauthn)
│  VK, envelopes,   │   frontend/src/lib/vault-session.ts ruft die Lib
│  sealed snapshot  │   Server sieht das nicht
└────────┬──────────┘
         │ opaque POST /snapshots
         ▼
┌─ Store ───────────┐   FastAPI /api/v1  oder  lokale SQLite
│  ciphertext + CAS │   Ownership 404, kein Entschlüsseln
└───────────────────┘
```

| Package / Pfad | Ist | Ist nicht |
|---|---|---|
| `@4allpass/crypto` | Protocol v1, pure functions | UI, Netz, Authenticator |
| `@4allpass/webauthn` | PRF → largeBlob → UV-gated | Vault-Crypto |
| `@4allpass/core` | Access-Policy (Allow/Deny) | Speichern von Secrets |
| `@4allpass/providers` | Domain ≠ Name, lokal | Server-Index |
| `frontend/` | PWA, alle Crypto-Calls, Desk | Server-Metadaten als Beweis |
| `extension/` | Chromium/Firefox Fill | Tresor-UI |
| `backend/` | Account, Ownership, CAS | Klartext, VK, PRF prüfen |
| `src-tauri/` | Desktop-Shell + local core | Zweites Protokoll |

Abhängigkeiten fließen **UI → session → crypto**. Store kennt nur Ciphertext.

---

## 2. Vault-Flow (eine Zeile)

1. Unlock (Master / Gerät / Recovery) → Einträge nur im RAM.  
2. Tippen in die Suche → Liste filtert live.  
3. Chip (Alle / Login / API / Server / Kurz) → gleiche Liste, weniger Zeilen.  
4. Stern → `favorite` am Eintrag, `saveEntries` (Snapshot). Row sonst → Detail.  
5. Detail: Name, User, Secret. Kopieren → OS-Clipboard.  
6. 30 s später: Clipboard überschreiben, **wenn** der Wert noch unserer ist.  
7. Speichern → AES-GCM + Manifest, CAS `expectedRevision`.  
8. Sperren → VK und Klartext zeroizen.

Autofill zählt **nicht** als „zuletzt verwendet“. Stempel = `updatedAt` beim Speichern.

---

## 3. Komponenten-Baum

```
App
├ header (Logo, Lock, optional E-Mail)
├ banner (error / notice)
└ main
   ├ AuthPage | CreateVaultPage | RestoreVaultPage | UnlockPage
   └ VaultPage
      ├ AccessBrokerHost          entries
      ├ VaultTabs                 tab, revision (sr-only)
      ├ VaultHeader               count, score, health, onShowWeak
      ├ VaultSearchAndFilters     query, kind, onAdd, onImportFile
      ├ VaultList                 filtered, health, onSelect, onToggleFavorite
      ├ VaultEntryForm | VaultDetailEmpty
      ├ AccessPanel | BrowserCards | VaultSettings | OnboardingWizard
      └ overlays: ImportReview, Share, ShareImport
```

Hooks: `useVaultState` (CRUD, Tabs), `useVaultSearch` (Query + Filter), `useVaultHealth` (ZXCVBN, Reuse, HIBP k-anonym).

Wichtige Props: `entries: VaultEntry[]` (Klartext nur unlocked), `draft` / `selectedId`, `favorite: boolean` am Eintrag, nie Passwort in der Liste.

**Tokens** (`frontend/src/tokens.css`, Golden Magpie):

| Token | Wert | Rolle |
|---|---|---|
| `--bg` | `#0A0E1A` | Fläche |
| `--bg-card` / `--panel` | `#12182B` | Karten |
| `--accent` / `--accent-hi` | `#C9A227` / `#D4AF37` | Gold, Primary, Stern an |
| `--text` | `#F8F4EC` | Titel |
| `--muted` | `#A89F8C` | Username, Meta |
| `--ok` / `--danger` | `#3DDC97` / `#ff7a90` | Health / Leak |

Radius/Schatten bleiben Desk-Chrome. Gnom-Hub-Grau ist nicht die Marke.

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

> Beobachtet im Code-Review 2026-08-28. Status: `ROADMAP.md` §1b.

- `src-tauri/src/lib.rs` zerlegen (prozess, sleep, prompts, tray, proxy).
- `Cargo.toml` streng pinnen (`docs/supply-chain-security.md`).
- Sidecar-Erkennung nicht roh `ps`/`lsof`.

## 9. Modul-Grenzen

Ein Modul = eine Verantwortlichkeit. Faustregel: erklärbar in einem Satz ohne „und“. Test: Modul löschbar, ohne dass der Rest bricht.

## 10. Später (nicht bauen ohne Auftrag)

- Shamir als optionale Recovery
- **Team Mode** — Spec: [`team-mode.md`](team-mode.md). Kein PAM.

---

Tiefer: [`security-boundary.md`](security-boundary.md) · [`crypto-protocol.md`](crypto-protocol.md) · [`vault-revision.md`](vault-revision.md) · [`ui-map.md`](ui-map.md). Vision nicht bauen: [`architecture/future-architecture.md`](architecture/future-architecture.md).

Account-Login entschlüsselt den Tresor nicht. `DELETE /devices` ist `metadata_only`. Beides: [`security-boundary.md`](security-boundary.md).
