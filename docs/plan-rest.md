# Restplan — 4AllPass

Stand: 2026-08-24. `main` = `b2ab441`.

Quelle der Reihenfolge: [`product-maturity.md`](product-maturity.md) **v3**.  
Diese Datei ist die **Kurzfassung des Rests** — nicht ein zweiter Plan.

---

## Leitlinie

```text
Install → Import → Autofill → fertig
```

Autofill ist das Produkt. Access/Programme ist nicht der erste Bildschirm.  
Website bekommt **nie** den Vault. FastAPI mintet **keine** Tokens.

---

## Als Nächstes (genau das)

Kein weiterer Code-Slice in dieser Reihenfolge.

1. **Fremder Mac (P0, menschlich)**  
   App auf → Tresor → Browser-Karten → Import-Review **ohne Passwort in der Liste** → Bestätigen.  
   Review-UI ist in CI für Datei-Import (`frontend/e2e/local/import-review`). Browser-Karten-Import auf einem fremden Rechner bleibt ein Mensch-Test.

2. **Live `github.com/login` (P1, optional, manuell)**  
   Ein Fill, Username-Seite dann Passwort-Seite — kein Multi-Step-Engine.  
   Fixture + Playwright sind da (`test-login-github.html`, `autofill-local`). CI trifft github.com nicht.

---

## Pausiert (Geld)

**Apple-Doppelklick** (~99 USD/Jahr, [#112](https://github.com/landjunge/4AllPass/issues/112)).

- Signing-CI ist auf `main` (`#111`).
- Ohne Abo: kein notariertes DMG, kein Tag `v0.1.2`, kein Store.
- Bis dahin: [`install-terminal.md`](install-terminal.md) / `scripts/install.sh`, Rechtsklick → Öffnen.

---

## Später im selben Plan (nicht jetzt)

| Was | Warum später |
|---|---|
| Shadow DOM / iframe / Multi-Step | P1b, extra Engine |
| Passkey-Store / Conditional UI | echte Platform-APIs, nicht simulieren |
| Safari-Import, Windows/Linux-Import | erst nach Fremder-Chrome/Firefox |
| Sichtbarkeit / Launch-Posts | erst nach P0+P1, nicht auto-publishen |

---

## Nicht in dieser Reihenfolge

Team Mode (nur Review: [`team-mode.md`](team-mode.md) — kein PAM), 50 Provider, Zurückschreiben in Chrome/Firefox, MCP, n8n-Marketplace, Cloud-Sync, Connection-/Capability-Umbau (ChatGPT-Review: **nicht bauen**, bis explizit gesagt).

---

## Parked (Plus / Community, Default aus)

| Thema | Issue |
|---|---|
| Clipboard-Watcher | `#59` |
| Provider-Service-Verwaltung | `#65` |
| Secret Access Layer | `#67` |
| Capability-Vertrag 4AP-CAP-1 | `#70` |

Einmal-Erkennung der Zwischenablage (kein Watcher) ist auf `main`.

---

## Code-Teil (durch, auf `main`)

| Bereich | Was liegt |
|---|---|
| P0 Install | `scripts/install.sh` + rolling Tag `desktop` + SHA-256. Dieser Intel-Mac: Befehl → Fenster. Vault unangetastet. |
| P0 Import | Browser-Karten Chrome/Firefox, Review ohne Passwort, nie still, nie Live-DB schreiben. |
| P0 Provider | Exact / subdomain / login-domain / unknown. `evilgithub.com` ist nicht GitHub. |
| P1 Autofill | Field Intelligence + Safe Fill + Verify. Demo + GitHub-Fixture. Fill nur fokussierter Tab. |
| P1b Assist / Why | Misserfolg erklärt Felder lokal, keine Secrets. Assisted Fill bei Confidence < 0.70. |
| P2 Access | Why, Simulator, Loopback 127.0.0.1, Origin 403, unknown DENY. Nicht erster Bildschirm. |
| P3 TOTP | RFC 6238 am Vault-Eintrag. Secret nur im verschlüsselten Entry. |
| Härten | Digest-Pin braucht `sealedManifest`. Import-Pfade enthalten. CSP auf Sidecar-Origin. Tresor zu: Button oder Ruhemodus. Leichte Sprache an. |

**Offen bleiben nur:** ein fremder Mac, optional live GitHub, Apple wenn das Abo geht.

---

## Gesperrte Reihenfolge

```text
P0  Install + Import + Provider     (Code da; Fremden-Test offen)
 → P1  Reliable Autofill             (Code da; live GitHub manuell)
    → P1b Diagnostics / Assisted     (Assist/Why da; Shadow DOM später)
       → P2  Agent UX                (Code da; First Screen nicht)
          → P3  Passkeys / OTP       (TOTP da; Passkey-Store später)
             → Sichtbarkeit nur nach P0+P1
```

Apple (Phase A) bleibt Geld-Blocker, parallel nicht als Ausrede für Feature-Flut.

---

## Definition of Done — was noch offen ist

- [ ] Fremder Mac: App auf, Tresor, Browser-Karten, Import-Review ohne Passwort.
- [ ] Live `github.com/login` (manuell, optional).
- [ ] Fremder Mac: Doppelklick, kein Terminal — **nur wenn Apple-Abo geht.**

Alles andere in der DoD von [`product-maturity.md`](product-maturity.md) ist abgehakt.

---

## Harte Grenzen (nicht verhandeln)

- Kein Core-Rewrite, kein zweites Tauri, kein Tollgate.
- FastAPI gibt keine Tokens aus, sieht keinen Klartext.
- Unknown App = DENY. Loopback nur `127.0.0.1`. Fremde Origin = 403.
- Browser-DBs nie mutieren. Kein stiller Import.
- Kein Klartext in Logs oder Review-Liste.
- Website bekommt nie den Vault.
- DE+EN auf öffentlichen Oberflächen.
- Kein Tag `v0.1.2`, bis Apple bezahlt ist.
- Launch-Posts nicht auto-publishen.
- Team Mode nicht implementieren, bis das Review angenommen ist.
- Connection/Capability-UI nicht bauen, bis explizit gesagt.

---

## Specs (wenn man tiefer muss)

| Thema | Datei |
|---|---|
| Reihenfolge / DoD | [`product-maturity.md`](product-maturity.md) |
| Autofill | [`autofill-v1.md`](autofill-v1.md) |
| Browser-Import | [`browser-sync.md`](browser-sync.md) |
| Terminal-Install | [`install-terminal.md`](install-terminal.md) |
| Apple / DMG | [`distribution.md`](distribution.md) |
| Was der laufende Code wirklich erzwingt | [`security-boundary.md`](security-boundary.md) |
| Haltung | [`product-philosophy.md`](product-philosophy.md) |
