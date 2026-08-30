# 4AllPass — Feature-Vergleich

Nur Zeilen mit ✅ sind im **laufenden** Produkt nachweisbar (`docs/security-boundary.md`, PWA, Backend). Geplantes steht als ⏳. Unbelegte Behauptungen sind ein Defekt. Eine *Zielkategorie* (Password Manager + persönlicher Secret Access für Apps/Agenten) steht in [`positioning-target.md`](positioning-target.md) — deren Scorecard **nicht** hierher kopieren.

Legende: ✅ stark/vorhanden · ⚠️ vorhanden mit Einschränkungen · ❌ nicht vorhanden · ⏳ geplant

| Kriterium | 4AllPass | Bitwarden | 1Password | Proton Pass |
|---|---|---|---|---|
| Self-Hosting / placement | ✅ Default: this device (Desktop / `npm run app`, SQLite). Own FastAPI server optional. Hosted Vault later, same protocol (`docs/vault-storage.md`). No mandatory cloud. | ✅ optional (Vaultwarden trivial); server is part of the concept | ❌ their infrastructure | ❌ |
| Zero-Knowledge | ✅ Server sieht keine Klartext-Einträge und keine Vault Keys | ✅ | ✅ | ✅ |
| Master-Passwort-Ableitung | ✅ Argon2id (Profile in `packages/crypto`) | ⚠️ PBKDF2/Argon2id konfigurierbar | ⚠️ PBKDF2 + Secret Key | ✅ Argon2 |
| WebAuthn / Passkey-Unlock | ⚠️ PRF > largeBlob im **Protokoll**; in der Tauri-Webview **unbewiesen**. Unlock = Tresor-Passwort | ⚠️ vorhanden, oft Zusatzschritt | ⚠️ vorhanden | ✅ |
| AI-Agent-Zugang | ⚠️ Loopback Allow/Deny, FastAPI mintet keine Tokens. Identität ist ein **String**. Nach Allow bekommt der Agent das **Roh-Secret**; TTL holt eine Kopie nicht zurück. Kein Fill in die Seite ohne Secret beim Agenten. | ⚠️ Agent Access SDK, frühe Alpha ([Ankündigung](https://bitwarden.com/blog/introducing-agent-access-sdk/)): menschliche Freigabe, E2E-Pfad, CLI injiziert ins Kindprozess. Nicht produktionsreif; Sample-Daten empfohlen. | ✅ [1Password for Claude](https://support.1password.com/1password-claude-security/): Agent sieht keine Secrets; Fill in die Seite nach Freigabe in der Desktop-App. Pairing über OS-Code-Signing. | ⚠️ [Access Tokens](https://proton.me/support/pass-access-tokens) (Plus+): Vault-Zugriff, Ablauf 1 h–1 Jahr, Aktivitätsprotokoll. Token-Inhaber liest Credentials — kein seiteninternes Fill ohne Secret. |
| Selective Item-Sharing | ⚠️ Encrypted share file + share key (`docs/sharing.md`); no live wrap to a foreign device | ⚠️ Collection-/Vault-Ebene | ⚠️ Vault-Ebene | ⚠️ eingeschränkt |
| Offene Testvektoren / Threat Model | ✅ `docs/threat-model.md`, `docs/adversarial-review.md`, `docs/test-vectors*.md` | teilweise | ❌ nicht öffentlich | teilweise (Audit-Berichte) |
| Unabhängiges Security-Audit | ⏳ vorbereitet in `docs/audit-scope.md` | ✅ regelmäßig | ✅ regelmäßig | ✅ (u. a. Cure53) |
| Preis / Lizenz | Self-Hosting, keine Abo-Gebühr. [PolyForm Noncommercial 1.0.0](../LICENSE): quelloffen, privat frei, kommerziell nur mit Erlaubnis von Daniel Filipek. Nicht MIT/Apache (OSI würde Firmen erlauben). | ~20 $/Jahr Premium (Stand 2026) | ~40–70 $/Jahr | 0–24 $/Jahr |
| Autofill | ⚠️ Chromium + Firefox + Safari-Wrapper; Field Intelligence V1. iOS/Android native ⏳. Kein Store-Listing | ⚠️ oft kritisiert | ✅ stark | ⚠️ teils unzuverlässig |
| Emergency Access / Recovery | ✅ Recovery Key + Emergency Kit in der PWA (`docs/recovery.md`); kein Server-Reset, kein Trusted-Contact-Wait | ✅ [Emergency Access](https://bitwarden.com/help/emergency-access/) (Premium): Trusted Contact, View oder Takeover nach Wartezeit | ✅ | ⚠️ oft nur höhere Tarife |
| Kryptografische Gerätebindung | ✅ WebAuthn PRF → DWK → DK → VK | ⚠️ Geräte sind meist organisatorisch | ⚠️ Secret Key + Geräte | ⚠️ |
| Hard-Revoke (Vault-Key-Rotation) | ✅ PWA `hardRevokeDevice` (VK+1, re-encrypt, omit target, CAS, dann metadata DELETE) | n/a | n/a | n/a |

Wettbewerber-Spalten stützen sich auf öffentliche Produktangaben, Stand **30. August 2026** — nicht auf eigene Messungen ihrer Binaries. Agent-Zeile und Bitwarden-Emergency-Access an dem Tag gegen die verlinkten Herstellerseiten korrigiert.

Quellen für die 4AllPass-Spalte:

- Self-Hosting / placement: Desktop / `python -m app.local` (SQLite). Postgres+Redis: README „Server“. Model: `docs/vault-storage.md`
- ZK / KDF / PRF: `packages/crypto`, `packages/webauthn`, `docs/crypto-protocol.md`, `docs/webauthn-prf.md`. PRF in WKWebView: unproven
- Agent access: `packages/access`, sidecar `broker.py`, `docs/security-boundary.md` § loopback. Application identity is a string. Grant is `raw_secret`. 1Password for Claude fills the page without showing the secret to the agent — not feature-parity. Bitwarden Agent Access SDK and Proton Pass access tokens exist; neither is ❌.
- Recovery: `frontend/src/components/RecoveryKitDialog.tsx`, `docs/recovery.md`
- Unlock-UX: `frontend/src/pages/UnlockPage.tsx`
- Autofill: `extension/`, `docs/autofill-extension.md`
- Hard-Revoke: `frontend/src/lib/vault-session.ts` (`hardRevokeDevice`)
- Grenzen: `docs/security-boundary.md`
- Lizenz: `LICENSE` (PolyForm Noncommercial 1.0.0). Quelloffen. Privat frei. Kommerziell nur mit Erlaubnis von Daniel Filipek. Nicht MIT/Apache.
- Item-share file: `docs/sharing.md`, `frontend/src/lib/share.ts`
