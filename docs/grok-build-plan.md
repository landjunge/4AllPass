# Grok Build – Ausführungsplan

> **Status:** aktiv. Dieses Dokument ist der **Einstiegspunkt für Grok Build**.
> Lies es zuerst, dann `docs/supply-chain-security.md`, dann `ROADMAP.md` für den Gesamtstatus, dann die Phasen unten.

---

## 0. Sofort-Anweisung (Pflicht)

Du bist Grok Build. Deine erste Aufgabe in diesem Repo:

**Supply-Chain-Sicherheit sofort umsetzen** – kein Warten, kein „später", keine Diskussion.

**Arbeitsreihenfolge (strikt):**

1. Lies `docs/grok-build-plan.md` (dieses Dokument).
2. Lies `ROADMAP.md` – lebende Roadmap, eine Datei, Status hier pflegen.
3. Lies `docs/supply-chain-security.md` komplett – das ist der ausführbare Plan mit Phasen 1–3.
4. Lies `docs/security-boundary.md` (Trust-Boundaries, Crypto-Kern).
5. Lies `docs/audit-scope.md` Modul **M6**.
6. Inventarisiere den aktuellen Stand:
   - `Cargo.lock`, `package-lock.json`, `requirements*.txt`, `libs.versions.toml`
   - `.github/workflows/ci.yml`
   - `packages/crypto` Dependency-Baum
7. Setze **Phase 1** um: Pinning + CI-Audits. Ein Commit pro logischer Einheit.
8. Setze **Phase 2** um: Crypto-Kern-Audit + Minimalismus.
9. Setze **Phase 3** um: SBOM + Incident-Runbook.
10. Aktualisiere die Checkliste in `docs/supply-chain-security.md` §6: ☐ → ☑ mit Datum und Notiz.
11. Öffne **keinen** PR, der die CI rot macht. Finding blockiert CI → fixen oder als `allow` mit Begründung dokumentieren.

**Definition of Done:**

- [x] Alle Lockfiles committed und in CI enforced (`--locked`, `npm ci`).
- [x] `cargo audit`, `cargo deny`, `npm audit --audit-level=high`, `pip-audit` laufen in CI und schlagen bei high/critical fehl.
- [x] `packages/crypto` hat keine Netzwerk- oder UI-Abhängigkeiten.
- [x] SBOM-Erzeugung ist im Release-Workflow vorhanden.
- [x] Checkliste §6 ist aktuell.
- [x] Findings (falls vorhanden) in `docs/reviews/attack-vectors.md` dokumentiert.

**Nicht tun:**

- Keine großen Refactors außerhalb der Supply-Chain.
- Keine neuen Features.
- Keine Secrets committen.
- Keine „while we're at it"-Aufräumarbeiten.
- **Keine neuen Plan- oder Roadmap-Dateien anlegen.** Alles in `ROADMAP.md` oder bestehende Specs.
- **Keine nativen Mobile-Apps bauen**, bevor die PWA steht. Die Skelette in `android-skeleton-grok-build.md` / `ios-skeleton-grok-build.md` sind nur Prompt-Vorlagen.

---

## 1. Verwandte ausführbare Pläne (Grok Build)

| Plan | Datei | Status |
|---|---|---|
| Supply-Chain (jetzt zuerst) | `docs/supply-chain-security.md` | Phasen 1–3 auf `main`; Private Registry offen |
| Code-Hygiene | `ROADMAP.md` §1b | ☑ 2026-08-28 |
| Secret Access Layer (vorbereiten) | `docs/secret-access-layer.md` + `docs/architecture/agent-access.md` | raw-secret / mediated interface / policy; MAIP später |
| Android-Skelett | `docs/android-skeleton-grok-build.md` | bereit (Prep, nicht vor PWA) |
| iOS-Skelett | `docs/ios-skeleton-grok-build.md` | bereit (Prep, nicht vor PWA) |
| Future Readiness | `docs/future-readiness.md` | offen |
| Lebende Roadmap | `ROADMAP.md` | Status hier pflegen |

**Reihenfolge:** Supply-Chain (done) → Code-Hygiene (done) → Secret Access Layer vorbereiten → Mobile (PWA → Android → iOS). MAIP nicht in dieser Sequenz. Status: `ROADMAP.md`.

---

## 1b. Code-Hygiene — completed 2026-08-28

> Quelle: Code-Review 2026-08-28. Details und Status: `ROADMAP.md` §1b.

1. **`src-tauri/src/lib.rs` aufteilen** – Prozess-Management, Sleep-Detection, Access-Prompts, Tray, HTTP-Proxy in eigene Module. **Getan** 2026-08-28.
2. **`Cargo.toml` streng pinnen** – exakte Versionen statt `"2"`. **Getan** 2026-08-28.
3. **`ps`- / `lsof`-Aufrufe abstrahieren** – Plattform-Schicht, nicht unix-spezifisch. **Getan** 2026-08-28 (`process_inspect.rs`).

**Definition of Done:**

- [x] `lib.rs` ist in Module zerlegt (Prozess, Sleep, Prompts, Tray, Proxy).
- [x] `Cargo.toml` pinnt exakte Versionen; CI enforced `--locked`.
- [x] Sidecar-Prozess-Erkennung läuft plattformneutral (kein roher `ps`/`lsof`-Aufruf im Hot Path).
- [x] Kein PR, der die CI rot macht.

---

## 1c. Produkt-Reihenfolge (Code vor Docs)

> Nach Supply-Chain und Phase 4: **Tresor → Broker → PWA → schauen, was fehlt.**
> Keine neuen Docs, solange nicht mindestens eine Datei im `src/`-Ordner dazukommt.

1. **Tresor** – Vault anlegen, Passwörter rein, speichern, wieder abrufen. Kern, den jeder Nutzer zuerst testet.
2. **Broker (Loopback)** – Agent fragt an → Allow/Deny → TTL läuft ab. Zettel-Türsteher, kein Ausweis.
3. **PWA** – Login, Homescreen-Icon, offline-fähig. Kein App Store.
4. **Schauen, was fehlt** – erst dann Autofill / native Apps entscheiden.

---

## 2. Phase 4 — Secret Access Layer (Zielbild)

> **Status heute:** Loopback-Broker mit String-Identität + Pairing-Token + human Allow.
> Pairing-Token ≠ Agent-Identität. Grant-Handoff ist `raw_secret`; TTL stoppt nur *zukünftige* Handoffs, nicht bereits kopierte Secrets.
> **Ziel:** signierte Tokens, kryptografische Agent-Identität, Provider-Templates. Default off, device-local, FastAPI sieht nie Grants oder Klartext.

**Autoritative Specs (lies alle vor dem Bau):**

- `docs/secret-access-layer.md` – das Modul, Phasen A–F, Zero-Knowledge-Regeln
- `docs/architecture/agent-access.md` – Ziel-Flow, Access-Klassen, Enrollment
- `docs/local-access-broker.md` – was heute wirklich läuft (ehrliche Limits)
- `docs/provider-service-vision.md` – Provider / Account / Secret Templates
- `docs/specs/maip-v0.1.md` – kryptografische Identität (experimentell)
- `docs/security-boundary.md` §7 – was der laufende Code erzwingt
- `docs/capability-interface.md` – Tollgate = Execution, nicht 4AllPass

**Ziel-Architektur (nicht bauen, bis Supply-Chain grün ist):**

```text
Agent
  → Ed25519-Identität (MAIP) verifiziert
  → 4AllPass Policy (Allow/Deny, Capability, TTL)
  → signiertes, zeitlich begrenztes Token
  → Provider-Template (Gmail / GitHub / Stripe / …) sagt, WIE zugegriffen wird
  → mediated proxy bevorzugt; raw_secret nur als expliziter Fallback
```

**Phasen (strikt in dieser Reihenfolge, keine Sprünge):**

1. **Phase A – Auto-Detection:** Erkenne, was der User einrichtet (n8n→OpenAI, github.com→GitHub). Frage, fülle nie still.
2. **Phase B – Browser Secret Fill:** Extension schlägt vor, User klickt. Kein Auto-Submit.
3. **Phase C – Local Secret Broker:** Loopback-Request → Policy-Anzeige → in-memory Handoff. Kein Env-Export als Happy Path.
4. **Phase D – Application Identity:** Code-Signatur / Bundle-ID als Identität. Ohne D kein „always allow".
5. **Phase E – Capabilities:** Grant-Records (App × Provider × Credential × Purpose × Expiry), lokal, ciphertext.
6. **Phase F – Agent Secrets:** Agent bekommt Capability, nie den ganzen Vault. Expiry = keine weiteren Handoffs.

**Harte Regeln (non-negotiable):**

- Device-local only. FastAPI sieht nie Grants, App-Identität, Purpose, Expiry oder Secret.
- Default off. Uninstalliert = heutiges ZK-Modell.
- Unlock required. Locked vault → Broker verweigert.
- Unknown = DENY. Prozessname ist keine Identität.
- Kein offenes localhost-HTTP ohne Auth. Kein CORS-offenes Grant-Endpoint.
- `packages/crypto` bleibt unverändert – keine neuen Envelope-Typen für dieses Modul.
- Kein Orchestrator, keine Execution-Policy. Tollgate bleibt getrennt.

**Definition of Done (Phase 4):**

- [ ] Mindestens Phase A+B als Extension-UX auf bestehendem Host-Fill.
- [ ] Phase C als Loopback-Broker mit Policy-Overlay, in-memory Handoff, kein Env-Default.
- [ ] Phase D: OS-Identität (code signature / bundle id) als first-class Objekt; unknown DENY erzwungen.
- [ ] Phase E: Grant-Records lokal + ciphertext, lesbar in der UI.
- [ ] Tests: Unknown-Agent-Deny, TTL-Expiry, Locked-Vault-Deny, Origin-403 auf Grant-Path.
- [ ] Docs aktualisiert: `local-access-broker.md`, `architecture/agent-access.md`, `security-boundary.md` §7 spiegeln den neuen Stand.
- [ ] Kein PR, der die CI rot macht.

**Nicht tun in Phase 4:**

- Keine Server-seitige Grant-API, kein FastAPI-Token-Minting.
- Keine MCP-als-Sicherheit.
- Kein Auto-Submit, kein Clipboard-Watcher als Egress.
- Keine Zusammenführung mit Tollgate / Capability-Interface.

---

## 3. Autorität

```text
security-boundary.md          was der Code erzwingt
        ↓
supply-chain-security.md      Regeln für die Lieferkette (ausführbar)
        ↓
secret-access-layer.md        Zielbild Agent-Zugriff (ausführbar, Phase 4)
        ↓
dieses Dokument               Einstieg für Grok Build
        ↓
ROADMAP.md                    lebende Roadmap (eine Datei)
```

Wenn hier was steht, das über `security-boundary.md` hinausgeht: Defekt. Nicht umgekehrt.

---

*Zuletzt aktualisiert: 2026-08-28.*
