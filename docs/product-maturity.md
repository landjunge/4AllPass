# Produktreife — 4AllPass

Stand: 2026-08-23. **v2 Produktfokus.** Kein Core-Rewrite, kein zweites Tauri, kein Tollgate.

> **4AllPass makes authentication effortless for humans and controlled for machines.**  
> DE: Anmeldung soll für Menschen einfach sein. Maschinen bekommen Zugang nur kontrolliert.

FastAPI gibt **keine** Tokens aus. Launch-Posts nicht auto-publishen.

```text
HUMANS                         MACHINES
   │                              │
Reliable auth                  Controlled access
   │                              │
Autofill / Import              Agent / Capability
   │                              │
   └──────────────┬───────────────┘
                  ▼
          Credential Engine  →  Vault
```

Nicht: nächster Bitwarden/1Password. Differenzierung ist **Vault + zuverlässiges Autofill + kontrollierter Agent-Zugang**.

---

## Product strategy (five lines)

1. Credentials easy to use.
2. Autofill reliable.
3. Storage secure (ZK, this device).
4. Access controllable.
5. Agents never need the underlying password.

**Reliability before expansion.** Keine 20 neuen Features, solange Install, Import, Provider, Autofill, Vault nicht zuverlässig sind.

---

## Wo der Code heute steht (ehrlich)

| Baustein | Stand |
|---|---|
| Tresor, Crypto, Hard-Revoke, CAS | auf `main` — **nicht anfassen** |
| Desktop (Tauri) | auf `main` |
| Browser-Karten + Chrome/Firefox-Import + Review | auf `main` — [`browser-sync.md`](browser-sync.md) |
| Provider-Resolver (Domain ≠ Provider, Confidence) | `@4allpass/providers` — [`provider-resolution.md`](provider-resolution.md) |
| Extension Chromium + Firefox + Safari-Wrapper | auf `main` — Fill ist **noch** `input[type=password]`-Niveau |
| Access-Policy, Broker, Allow/Deny | auf `main`, **nicht** erster Bildschirm |
| Apple-Notarisierung | CI `#111`, **pausiert** (~99 USD/Jahr, [#112](https://github.com/landjunge/4AllPass/issues/112)) |

---

## Prioritäten

### P0 — Reliability (jetzt)

Was ein Fremder merkt: App auf, Tresor, Browser erkannt, Import bestätigt, Login auf einer Seite.

- Desktop startet (ad-hoc: Rechtsklick / Terminal-Install [`install-terminal.md`](install-terminal.md)).
- First Run: Tresor + Recovery-Kit, keine Lügen.
- Import: Kopie der Browser-DB → Review **ohne Passwort** → Confirm → `saveEntries`. Nie still, nie Live-DB schreiben.
- Provider: exact / subdomain / login-domain / unknown. `evilgithub.com` ist nicht GitHub. Origin bleibt Trust-Grenze.

### P1 — Autofill als Milestone

Die Extension ist der **Ausführungsarm**, nicht das Produkt. Ziel: **Credential Interaction Engine** — eine Schicht für Import, Autofill und später Agenten.

V1 (bauen, nicht alles auf einmal):

```text
Seite → Field Intelligence → Login-Modell → Provider → Vault-Match
     → Safe Fill (native / controlled / assist) → Verify (lokal, keine Secrets)
```

Nicht raten unter Confidence 0,70. Nicht `value = password` als einzige Strategie. Website bekommt **nie** den Vault.

Danach, nicht vorher: Multi-Step, Shadow DOM, iframe, Diagnostics (lokal: erkannt/gefüllt/Ergebnis), Assisted Fill.

Passkeys/OTP/SSO **nach** stabilem Password-Autofill. Passkeys nicht selbst simulieren.

### P2 — Agent Access (vorhanden, polish später)

Allow/Deny bleibt. Jede Entscheidung soll irgendwann ein **Why** haben. Simulator und Security-Status: nach Autofill-V1. Der Agent bekommt möglichst **kein** Passwort.

---

## Was wir nicht tun

Kein Core-Rewrite. Kein zweites Tauri. Keine 500 Provider. Kein Browser-Zurückschreiben. Kein Safari-Keychain / Windows / Linux-Import, bis Chrome+Firefox-Import von einem Fremden getestet ist. Kein MCP, kein n8n-Marketplace, kein Cloud-Sync, kein Enterprise, keine KI im Resolver.

---

## Reihenfolge (gesperrt)

```text
P0  Install + Import + Provider  (weitgehend im Baum; Fremden-Test offen)
    → P1  Reliable Autofill (nächster Code)
        → P1b Diagnostics / Assisted
            → P2  Agent UX (Why, Simulator) — Code existiert, First Screen nicht
                → Passkeys / OTP
                    → Sichtbarkeit nur nach P0+P1
```

Apple Doppelklick (Phase A unten) bleibt **Geld-Blocker**, parallel nicht als Ausrede für Feature-Flut.

---

## Leitlinie für den Nutzer

```text
Install → Import → Autofill → fertig
```

Under the hood: Crypto, Provider Intelligence, Policy. Der Mensch muss die Architektur nicht kennen.

**Why:** „Ich öffne eine Login-Seite, 4AllPass erledigt den Login.“  
**Später:** „Mein Agent bekommt trotzdem nicht einfach das Passwort.“

---

## Phase A — Doppelklick (Apple, pausiert)

**Status:** in Arbeit / **pausiert**. CI auf `main` (`#111`). Blocker: Apple Developer ~99 USD/Jahr, nicht leistbar. Kein kostenloser Notarisierungs-Weg. Releases **ad-hoc**.

1. ~~Signing-CI mergen~~ — `#111`.
2. Secrets laut [`distribution.md`](distribution.md), wenn das Abo geht.
3. Tag `v0.1.2` → notariertes DMG.
4. Test auf **fremdem** Mac: Doppelklick.

Bis dahin: Terminal-Install [`install-terminal.md`](install-terminal.md), Rechtsklick → Öffnen.

### First Run / Uninstall (Phase B, Texte)

Unlock = Tresor-Passwort. PRF in der Webview **unbewiesen**. Recovery-Kit nicht überspringbar. Uninstall löscht **nicht** still den Vault (`Application Support` / `%APPDATA%` / `.local/share`).

Sichtbarkeit (Phase C) erst nach P0+P1. Nicht auto-publishen.

---

## Definition of Done

Sicherheit:

- [x] FastAPI mintet keine Tokens. (halten)
- [ ] README/Release sagen die Wahrheit zu Notarisierung, PRF, Autofill-Zuverlässigkeit.

P0:

- [ ] Fremder: App auf, Tresor, Browser-Karten, Import-Review ohne Passwort in der Liste.
- [ ] `evilgithub.com` wird nicht zu GitHub.

P1:

- [ ] Ein Login auf einer echten Seite ohne Copy-Paste (GitHub oder gleichwertig).
- [ ] Misserfolg erklärt Felder, nicht nur „Autofill failed“.

Installation (Apple, wenn leistbar):

- [ ] Fremder Mac: Doppelklick, kein Terminal.

Recovery:

- [ ] Nutzer versteht: ohne Kit / zweites Gerät kein Zurück. Kein Server-Reset.

---

## Nächster Schritt (genau einer)

**Code:** Autofill-V1 in der bestehenden Extension — Field Intelligence + Safe Fill + lokale Verify. Dieselbe Provider-Auflösung wie der Import. Kein neues Paket-Universum, kein Core-Rewrite.

**Nicht jetzt:** Access-Simulator, 50 Provider, Safari-Import, Launch-Post.

**Geld:** Apple weiter pausiert ([#112](https://github.com/landjunge/4AllPass/issues/112)).
