# Freeze — 2026-08-26

**DE.** Code-Stand nach internem adversarial Review. Kein Launch, kein Store, kein Dritt-Audit.
**EN.** Code snapshot after an internal adversarial review. Not a launch, not a store build, not a third-party audit.

Commit family: `#123` + `#124` + `#125` (Install pin `desktop`) + freeze #2 `#127` + vault-first UI `#133`–`#141` on `main`. Specs: [`security-boundary.md`](security-boundary.md), [`adversarial-review.md`](adversarial-review.md), [`adversarial-review-boundaries.md`](adversarial-review-boundaries.md), [`adversarial-review-external-01.md`](adversarial-review-external-01.md), [`audit-scope.md`](audit-scope.md). Product page: `https://4allpass.netzwerkpunkt.de/` (Let’s Encrypt). GitHub Pages: `https://landjunge.github.io/4AllPass/` (Actions).

---

## What this freeze is

| Held | Not claimed |
|---|---|
| Crypto core + sealed snapshots + hard revoke | Independent third-party audit |
| Autofill V1 (no Shadow DOM / iframe engine) | “Fill works on every website” |
| Pairing token + human Allow for agents | Cryptographic agent identity |
| Rank 3 UV-gated store | Face ID = hardware-bound vault |
| Compromised recovery → VK++ | Old print un-known on a copy already given |
| Native import temp `0700` + zeroize + redacted Debug | Persistent AEAD seal counter (F-25, policy) |

README remains honest: **no independent third-party audit yet.**

---

## What a tester can do without Apple and without a second Mac

Same machine is allowed. Do not file this as `#120` (that issue needs a **stranger** Mac).

1. Terminal-Install: [`install-terminal.md`](install-terminal.md) / `scripts/install.sh`. Vault folder stays on re-install.
2. First run: Tresor + Recovery-Kit (nicht überspringen).
3. Browser-Karten → Import-Review: Host + Username, **kein Passwort in der Liste**. Confirm. Browser-DB nicht mutiert.
4. Extension: `frontend/public/test-login.html` füllen. Optional live `github.com/login` (kein Submit).
5. Access-Tab: [`two-minute-demo.md`](two-minute-demo.md) — Allow / delete DENY / TTL / unknown DENY. Secret nicht in Audit-Zeilen.
6. Geräte: Rank-3-Hinweis lesen, wenn PRF fehlt. „Kit gestohlen“ nur testen, wenn du das Kit wirklich rotieren willst.

**DE+EN** in der UI. Website bekommt nie den Vault. FastAPI mintet keine Tokens.

---

## What a tester must not do

- Launch-Posts, Store, Tag `v0.1.2`.
- Connection/Capability, Team Mode, MCP, Tollgate.
- Passkey-Store simulieren.
- Pairing-Token wie eine Session-ID behandeln — das ist der lokale Root-of-Access für Agenten.
- Rang 3 als „Touch ID bindet den Authenticator kryptografisch“ beschreiben.

---

## Fremder Mac (#120) — übersprungen, Besucher kommt die Tage

Nicht als erledigt. Derselbe Entwickler-Mac zählt nicht. Wenn jemand mit einem **anderen** Mac da ist, nur das:

### Checkliste für den Besuch (10–15 min)

**DE**

1. Terminal, ein Befehl, Enter — Fenster muss aufgehen:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.sh | sh
   ```

   Intel → `*_x64.dmg`. Apple Silicon → `*_aarch64.dmg`. Ohne Apple-Notar: Script nimmt Quarantäne weg. Doppelklick allein kann warnen — das ist [#112](https://github.com/landjunge/4AllPass/issues/112), nicht der Vault.

2. Tresor anlegen. Recovery-Kit **nicht** überspringen. Blatt/Datei weglegen.

3. Browser-Karten: Chrome/Firefox sichtbar?

4. Import: Review zeigt Host + Username. **Kein Passwort in der Liste.** Bestätigen. Chrome/Firefox selbst unverändert.

5. Optional: in der App Demo-Login öffnen oder Extension `test-login.html` füllen. Nicht Submit auf einer echten Seite verlangen.

6. Eine Zeile notieren: Mac-Modell, was ging, was hakte (Gatekeeper, Pfad, UX). Das gehört in [#120](https://github.com/landjunge/4AllPass/issues/120).

**EN** — same six steps. Vault password stays on that Mac. No silent import. The website never gets the vault.

---

## What still needs a human or money

| Item | Issue |
|---|---|
| Fremder Mac: Install, Karten, Review | [#120](https://github.com/landjunge/4AllPass/issues/120) |
| Apple Notar / Doppelklick | [#112](https://github.com/landjunge/4AllPass/issues/112) |
| Externes Audit | [#38](https://github.com/landjunge/4AllPass/issues/38) |

Shadow DOM, Passkey-Store, Launch: später, gleicher Plan — nicht dieser Freeze.

---

## Security freeze #2 (2026-08-26)

External static review of `01ba6b5`. Crypto core left alone. Hülle:

| Item | Status |
|---|---|
| Tauri does not treat a pre-bound `:8788` as our UI | in this freeze |
| `lock()` wipes `totpSecret` | in this freeze |
| Agent grant is `raw_secret_handoff` (honest) | in this freeze |
| Pairing token / `n8n` string is not agent identity | documented; crypto enrollment **not built** |
| Extension HTTP only on loopback | in this freeze |
| Snapshot/body ceilings on the server | in this freeze |
| Nginx CSP + local Host check | in this freeze |
| CI npm/pip audit blocking | in this freeze |
| Installer: SHA-256 ≠ GitHub-account security | documented; Apple still paused |
