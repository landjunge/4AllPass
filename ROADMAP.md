# 4AllPass – Roadmap (lebende Datei)

> **Status:** aktiv. Das ist die **eine** Roadmap-Datei. Keine neuen Spezial-Pläne anlegen – hier rein, Status updaten, fertig.
> Grok Build: Lies zuerst `docs/grok-build-plan.md`, dann diese Datei für den Gesamtstatus.

---

## 0. Sofort (Grok Build, kein Warten)

1. **Supply-Chain** – `docs/supply-chain-security.md` Phasen 1–3. Pinning, CI-Audits, SBOM. Kein PR, der CI rot macht.
2. **Phase 4 – Secret Access Layer** – `docs/secret-access-layer.md` + `docs/architecture/agent-access.md`. Signierte Tokens, kryptografische Agent-Identität, Provider-Templates. Erst nach grüner Supply-Chain.
3. **Mobile** – **PWA zuerst**, dann native. Android-Skelett (`docs/android-skeleton-grok-build.md`) und iOS-Skelett (`docs/ios-skeleton-grok-build.md`) sind nur Prompt-Vorlagen – **kein** Freifahrtschein, native Apps vor der PWA zu bauen. Reihenfolge: PWA → Android → iOS.

---

## 1. Produkt-Reihenfolge (NOW)

Quelle der Wahrheit für Code-Prioritäten: `docs/product-maturity.md` (v3).

```text
P0  Install + Import + Provider          (Code auf main; Fremden-Mac-Test offen)
 → P1  Reliable Autofill                  (nächster Code, Spec: autofill-v1.md)
     → P1b Diagnostics / Assisted
         → P2  Agent UX (Why, Simulator)   (Code existiert, nicht First Screen)
             → P3  Passkeys / OTP
                 → Sichtbarkeit nur nach P0+P1
```

**Konkrete nächste Schritte (Code vor Docs):**

1. **Tresor** – Vault anlegen, Passwörter rein, speichern, wieder abrufen. Der Kern, den jeder Nutzer als Erstes testet.
2. **Broker (Loopback)** – Agent fragt an, du sagst ja oder nein, TTL läuft ab. Zettel-Türsteher, kein Ausweis.
3. **PWA** – Login, Homescreen-Icon, offline-fähig. Kein App Store, kein Review.
4. **Schauen, was fehlt** – erst dann entscheiden, ob Autofill / native Apps überhaupt noch nötig sind.

| Baustein | Status |
|---|---|
| Tresor, Crypto, Hard-Revoke, CAS | auf `main` – nicht anfassen |
| Desktop (Tauri) | auf `main` |
| Extension Chromium + Firefox + Safari-Wrapper | auf `main` |
| Access-Policy, Broker, Allow/Deny | auf `main` |
| Apple-Notarisierung | pausiert (~99 USD/Jahr) |
| Unabhängiges Dritt-Audit | offen (#38) |
| Fremder-Mac-Test | offen (#120, übersprungen) |

---

## 1b. Code-Hygiene (nach Supply-Chain, vor Phase 4)

> Quelle: Code-Review 2026-08-28. Nicht neu erfinden – hier pflegen.

1. **`src-tauri/src/lib.rs` aufteilen** – Prozess-Management, Sleep-Detection, Access-Prompts, Tray, HTTP-Proxy in eigene Module. Heute ein Monolith, schwer zu testen.
2. **`Cargo.toml` streng pinnen** – exakte Versionen statt `"2"`. Eigene Supply-Chain-Regel gilt zuerst für das eigene Projekt.
3. **`ps`- / `lsof`-Aufrufe abstrahieren** – hinter eine Plattform-Schicht, damit der Sidecar nicht nur auf Unix läuft.

| Punkt | Status |
|---|---|
| `lib.rs` Modularisierung | ☐ offen |
| `Cargo.toml` Pinning | ☐ offen |
| Plattform-Abstraktion (ps/lsof) | ☐ offen |

---

## 2. Grok-Build-Pläne (ausführbar)

| Plan | Datei | Status |
|---|---|---|
| Supply-Chain | `docs/supply-chain-security.md` | offen – jetzt |
| Code-Hygiene | dieses Dokument §1b | offen – nach Supply-Chain |
| Secret Access Layer (Phase 4) | `docs/secret-access-layer.md` | offen – nach Supply-Chain |
| Android-Skelett | `docs/android-skeleton-grok-build.md` | bereit (Prep, nicht vor PWA) |
| iOS-Skelett | `docs/ios-skeleton-grok-build.md` | bereit (Prep, nicht vor PWA) |
| Future Readiness | `docs/future-readiness.md` | offen |

**Reihenfolge:** Supply-Chain → Code-Hygiene → Phase 4 → Mobile (PWA → Android → iOS).

---

## 3. Future Readiness (vor dem ersten Nutzer)

Quelle: `docs/future-readiness.md`.

| Punkt | Status |
|---|---|
| Exit-Strategie / Export-Format | ☐ offen |
| Exit-Strategie / Import-Anleitung | ☐ offen |
| Crypto-Agility / KDF-Migration | ☐ offen |
| Crypto-Agility / AEAD-Migration | ☐ offen |
| Rechtliches / Impressum + Datenschutz | ☐ prüfen |
| Rechtliches / DSGVO-Antworten | ☐ offen |
| Rechtliches / Support-Kanal | ☐ offen |

Empfohlene Reihenfolge: Exit → Rechtliches → Crypto-Agility.

---

## 4. Bewusst nicht (bis explizite Entscheidung)

- Team Mode, MAIP-Implementierung, Managed Hosting, S3/WebDAV-Picker
- Shadow DOM / Multi-Step / iframe (nach stabilem Password-Autofill)
- Passkey-Store, Launch-Posts, Connection/Capability-UI
- Kein Core-Rewrite, kein zweites Tauri, kein zweites Crypto
- **Keine nativen Mobile-Apps vor der PWA** (Skelette sind nur Vorbereitung)

Vision (nicht implementieren): `docs/architecture/future-architecture.md`.

---

## 5. Offene menschliche Checks

1. [#120](https://github.com/landjunge/4AllPass/issues/120) – Fremder Mac: App auf, Tresor, Browser-Karten.
2. [#112](https://github.com/landjunge/4AllPass/issues/112) – Apple ~99 USD/Jahr für Doppelklick / `v0.1.2`.
3. [#38](https://github.com/landjunge/4AllPass/issues/38) – Unabhängiges Dritt-Audit.

---

*Zuletzt aktualisiert: 2026-08-28. Lebende Datei – Status hier pflegen, keine Parallel-Pläne.*
