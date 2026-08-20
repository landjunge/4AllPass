# 4AllPass — Feature-Vergleich

Nur Zeilen mit ✅ sind im **laufenden** Produkt nachweisbar (`docs/security-boundary.md`, PWA, Backend). Geplantes steht als ⏳. Unbelegte Behauptungen sind ein Defekt.

Legende: ✅ stark/vorhanden · ⚠️ vorhanden mit Einschränkungen · ❌ nicht vorhanden · ⏳ geplant

| Kriterium | 4AllPass | Bitwarden | 1Password | Proton Pass |
|---|---|---|---|---|
| Self-Hosting | ✅ Kern (`docker-compose.yml`) | ✅ optional (eigener Server / Vaultwarden) | ❌ | ❌ |
| Zero-Knowledge | ✅ Server sieht keine Klartext-Einträge und keine Vault Keys | ✅ | ✅ | ✅ |
| Master-Passwort-Ableitung | ✅ Argon2id (Profile in `packages/crypto`) | ⚠️ PBKDF2/Argon2id konfigurierbar | ⚠️ PBKDF2 + Secret Key | ✅ Argon2 |
| WebAuthn / Passkey-Unlock | ✅ PRF > largeBlob > UV-gated local; PWA bietet Biometrie als Unlock | ⚠️ vorhanden, oft Zusatzschritt | ⚠️ vorhanden | ✅ |
| Selective Item-Sharing | ⏳ Crypto-Modell (Device-Envelopes) vorhanden, PWA-UI fehlt | ⚠️ Collection-/Vault-Ebene | ⚠️ Vault-Ebene | ⚠️ eingeschränkt |
| Offene Testvektoren / Threat Model | ✅ `docs/threat-model.md`, `docs/adversarial-review.md`, `docs/test-vectors*.md` | teilweise | ❌ nicht öffentlich | teilweise (Audit-Berichte) |
| Unabhängiges Security-Audit | ⏳ vorbereitet in `docs/audit-scope.md` | ✅ regelmäßig | ✅ regelmäßig | ✅ (u. a. Cure53) |
| Preis | Self-Hosting, keine Lizenz | ~20 $/Jahr Premium (Stand 2026) | ~40–70 $/Jahr | 0–24 $/Jahr |
| Autofill | ⚠️ Chromium: popup, ⌘/Ctrl+Shift+L, context menu; decrypt on-device; native iOS/Android ⏳ | ⚠️ oft kritisiert | ✅ stark | ⚠️ teils unzuverlässig |
| Emergency Access / Recovery | ✅ Recovery Key + Emergency Kit in der PWA (`docs/recovery.md`); kein Server-Reset | ❌ kein Master-PW-Recovery | ✅ | ⚠️ oft nur höhere Tarife |
| Kryptografische Gerätebindung | ✅ WebAuthn PRF → DWK → DK → VK | ⚠️ Geräte sind meist organisatorisch | ⚠️ Secret Key + Geräte | ⚠️ |
| Hard-Revoke (Vault-Key-Rotation) | ✅ PWA `hardRevokeDevice` (VK+1, re-encrypt, omit target, CAS, dann metadata DELETE) | n/a | n/a | n/a |

Wettbewerber-Spalten stützen sich auf öffentliche Produktangaben und Nutzerfeedback, Stand August 2026 — nicht auf eigene Messungen ihrer Binaries.

Quellen für die 4AllPass-Spalte:

- Self-Hosting: `docker-compose.yml`
- ZK / KDF / PRF: `packages/crypto`, `packages/webauthn`, `docs/crypto-protocol.md`, `docs/webauthn-prf.md`
- Recovery: `frontend/src/components/RecoveryKitDialog.tsx`, `docs/recovery.md`
- Unlock-UX: `frontend/src/pages/UnlockPage.tsx`
- Autofill: `extension/`, `docs/autofill-extension.md`
- Hard-Revoke: `frontend/src/lib/vault-session.ts` (`hardRevokeDevice`)
- Grenzen: `docs/security-boundary.md`
