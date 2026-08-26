# 4AllPass — Feature-Vergleich

Nur Zeilen mit ✅ sind im **laufenden** Produkt nachweisbar (`docs/security-boundary.md`, PWA, Backend). Geplantes steht als ⏳. Unbelegte Behauptungen sind ein Defekt. Eine *Zielkategorie* (Password Manager + persönlicher Secret Access für Apps/Agenten) steht in [`positioning-target.md`](positioning-target.md) — deren Scorecard **nicht** hierher kopieren.

Legende: ✅ stark/vorhanden · ⚠️ vorhanden mit Einschränkungen · ❌ nicht vorhanden · ⏳ geplant

| Kriterium | 4AllPass | Bitwarden | 1Password | Proton Pass |
|---|---|---|---|---|
| Self-Hosting / placement | ✅ Default: this device (Desktop / `npm run app`, SQLite). Own FastAPI server optional. Hosted Vault later, same protocol (`docs/vault-storage.md`). No mandatory cloud. | ✅ optional (Vaultwarden trivial); server is part of the concept | ❌ their infrastructure | ❌ |
| Zero-Knowledge | ✅ Server sieht keine Klartext-Einträge und keine Vault Keys | ✅ | ✅ | ✅ |
| Master-Passwort-Ableitung | ✅ Argon2id (Profile in `packages/crypto`) | ⚠️ PBKDF2/Argon2id konfigurierbar | ⚠️ PBKDF2 + Secret Key | ✅ Argon2 |
| WebAuthn / Passkey-Unlock | ⚠️ PRF > largeBlob im **Protokoll**; in der Tauri-Webview **unbewiesen**. Unlock = Tresor-Passwort | ⚠️ vorhanden, oft Zusatzschritt | ⚠️ vorhanden | ✅ |
| AI-Agent-Zugang | ✅ Loopback Allow/Deny, FastAPI mintet keine Tokens. Identität ist ein **String**, Grant = Credential+TTL, nicht JIT-pro-Call | ❌ (Secrets Manager team-fokussiert) | ✅ Unified Access / Credential Broker (Cloud, Enterprise) | ❌ |
| Selective Item-Sharing | ⚠️ Encrypted share file + share key (`docs/sharing.md`); no live wrap to a foreign device | ⚠️ Collection-/Vault-Ebene | ⚠️ Vault-Ebene | ⚠️ eingeschränkt |
| Offene Testvektoren / Threat Model | ✅ `docs/threat-model.md`, `docs/adversarial-review.md`, `docs/test-vectors*.md` | teilweise | ❌ nicht öffentlich | teilweise (Audit-Berichte) |
| Unabhängiges Security-Audit | ⏳ vorbereitet in `docs/audit-scope.md` | ✅ regelmäßig | ✅ regelmäßig | ✅ (u. a. Cure53) |
| Preis | Self-Hosting, keine Lizenz | ~20 $/Jahr Premium (Stand 2026) | ~40–70 $/Jahr | 0–24 $/Jahr |
| Autofill | ⚠️ Chromium + Firefox + Safari-Wrapper; Field Intelligence V1. iOS/Android native ⏳. Kein Store-Listing | ⚠️ oft kritisiert | ✅ stark | ⚠️ teils unzuverlässig |
| Emergency Access / Recovery | ✅ Recovery Key + Emergency Kit in der PWA (`docs/recovery.md`); kein Server-Reset | ❌ kein Master-PW-Recovery | ✅ | ⚠️ oft nur höhere Tarife |
| Kryptografische Gerätebindung | ✅ WebAuthn PRF → DWK → DK → VK | ⚠️ Geräte sind meist organisatorisch | ⚠️ Secret Key + Geräte | ⚠️ |
| Hard-Revoke (Vault-Key-Rotation) | ✅ PWA `hardRevokeDevice` (VK+1, re-encrypt, omit target, CAS, dann metadata DELETE) | n/a | n/a | n/a |

Wettbewerber-Spalten stützen sich auf öffentliche Produktangaben und Nutzerfeedback, Stand August 2026 — nicht auf eigene Messungen ihrer Binaries.

Quellen für die 4AllPass-Spalte:

- Self-Hosting / placement: Desktop / `python -m app.local` (SQLite). Postgres+Redis: README „Server“. Model: `docs/vault-storage.md`
- ZK / KDF / PRF: `packages/crypto`, `packages/webauthn`, `docs/crypto-protocol.md`, `docs/webauthn-prf.md`. PRF in WKWebView: unproven
- Agent access: `packages/access`, sidecar `broker.py`, `docs/security-boundary.md` § loopback. Application identity is a string. 1Password EAM is a different product (cloud, verified machine identity, JIT) — not a feature-parity target.
- Recovery: `frontend/src/components/RecoveryKitDialog.tsx`, `docs/recovery.md`
- Unlock-UX: `frontend/src/pages/UnlockPage.tsx`
- Autofill: `extension/`, `docs/autofill-extension.md`
- Hard-Revoke: `frontend/src/lib/vault-session.ts` (`hardRevokeDevice`)
- Grenzen: `docs/security-boundary.md`
- Item-share file: `docs/sharing.md`, `frontend/src/lib/share.ts`
