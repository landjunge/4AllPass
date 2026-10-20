# Grok Build – Ausführungsplan

> **Status:** aktiv. Dieses Dokument ist der **Einstiegspunkt für Grok Build**.
> Lies zuerst `docs/security-boundary.md`, dann `ROADMAP.md` für den aktuellen E01–E09-Gesamtauftrag und dieses Dokument. Datierte Phasen unten sind keine neue Freigabe für gesperrte Materialwege.

---

## 0. Sofort-Anweisung (Pflicht)

Du bist Grok Build. Prüfe zuerst den tatsächlichen Stand und bereits erledigte Arbeit:

**Aktueller Auftrag:** E01–E09 nach `ROADMAP.md`, konkrete abgegrenzte Pakete mit Codex abstimmen. Die unten bereits abgeschlossene Lieferkettenarbeit nicht erneut starten. AP-01 korrigiert aktive Anweisungen; dafür ist keine neue Quelldatei erforderlich.

**Arbeitsreihenfolge (strikt):**

1. Lies `docs/security-boundary.md` (implementierte Grenzen), dann dieses Dokument.
2. Lies `ROADMAP.md` – lebende Roadmap, aktuelle E01–E09-Zuordnung hier pflegen.
3. Lies `docs/supply-chain-security.md` komplett – das ist der ausführbare Plan mit Phasen 1–3.
4. Lies `docs/security-boundary.md` (Trust-Boundaries, Crypto-Kern).
5. Lies `docs/audit-scope.md` Modul **M6**.
6. Inventarisiere den aktuellen Stand:
   - `Cargo.lock`, `package-lock.json`, `requirements*.txt`, `libs.versions.toml`
   - `.github/workflows/ci.yml`
   - `packages/crypto` Dependency-Baum
7. Gleiche **Phase 1** ab: Pinning + CI-Audits; bereits belegte Arbeit übernehmen.
8. Gleiche **Phase 2** ab: Crypto-Kern-Audit + Minimalismus; offene Nachweise dem aktuellen Auftrag zuordnen.
9. Gleiche **Phase 3** ab: SBOM + Incident-Runbook; keine abgeschlossenen Schritte doppelt starten.
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
| Secret Access Layer (vorbereiten) | `docs/secret-access-layer.md` + `docs/architecture/agent-access.md` | A+B detect/ask 2026-08-28; mediated/policy; MAIP später |
| Android-Skelett | `docs/android-skeleton-grok-build.md` | bereit (Prep, nicht vor PWA) |
| iOS-Skelett | `docs/ios-skeleton-grok-build.md` | bereit (Prep, nicht vor PWA) |
| Future Readiness | `docs/future-readiness.md` | offen |
| Lebende Roadmap | `ROADMAP.md` | Status hier pflegen |

**Datierter Teilablauf:** Supply-Chain (done) → Code-Hygiene (done) → spätere Zugangs-/Mobile-Ziele. Die aktuelle E01–E09-Folge steht in `ROADMAP.md`; ein Zielbild aktiviert weder Materialzugriff noch native Mobile-Arbeit.

**Zuerst der Mensch** (kein Grok-Code): `ROADMAP.md` §0b. Offen: `@4allpass` auf npmjs (F-26). Node-Broker `timingSafeEqual` ist auf `main` (F-28) — nicht nochmal bauen.

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
> Bestehende Anweisungen dürfen gezielt ohne Codeänderung korrigiert werden. Die aktuelle Baufolge steht in `ROADMAP.md`; keine neue Roadmap anlegen.

1. **Tresor** – Vault anlegen, Passwörter rein, speichern, wieder abrufen. Kern, den jeder Nutzer zuerst testet.
2. **Broker (Loopback)** – Machine-DENY erhalten; historische Allow/TTL-Übergabe nicht wieder aktivieren. Produktive geschützte Ausführung braucht E07 samt Hostnachweis.
3. **PWA** – Login, Homescreen-Icon, offline-fähig. Kein App Store.
4. **Schauen, was fehlt** – erst dann Autofill / native Apps entscheiden.

---

## 2. Phase 4 — Secret Access Layer (Zielbild)

> **Status am 20.10.2026:** Aktueller Python-/Node-Broker, Frontend und Client verweigern maschinelle Materialübergaben auch nach Allow. Pairing-Token ≠ Agent-Identität. Historische RC2-Pakete enthielten Rohmaterial; ihre Kopien werden weder durch TTL noch diesen Dokumentabgleich zurückgerufen.
> **Ziel, noch nicht produktiv:** begrenzte geschützte Ausführung nach E03/E07 mit bestätigter Identität, Freigabe und echter Host-/Vaulttransfergrenze. Kein raw-secret-Fallback. FastAPI bleibt Speicherbackend ohne Tresorklartext.

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
  → geschützter Host führt die genau freigegebene Operation aus
  → nur begrenztes Ergebnis; ohne Hostnachweis DENY, kein Rohmaterial-Fallback
```

**Phasen (strikt in dieser Reihenfolge, keine Sprünge):**

1. **Phase A – Auto-Detection:** Erkenne, was der User einrichtet (n8n→OpenAI, github.com→GitHub). Frage, fülle nie still.
2. **Phase B – Browser Secret Fill:** Extension schlägt vor, User klickt. Kein Auto-Submit.
3. **Phase C – Local Secret Broker:** vorhandenes Machine-DENY erhalten; kein Material-Handoff. E07 verbindet erst nach tatsächlichem Hostnachweis eine begrenzte Operation.
4. **Phase D – Application Identity:** Code-Signatur / Bundle-ID als Identität. Ohne D kein „always allow".
5. **Phase E – Capabilities:** Grant-Records (App × Provider × Credential × Purpose × Expiry), lokal, ciphertext.
6. **Phase F – Geschützte Nutzung:** Agent erhält nur das begrenzte Operationsergebnis; Ablauf und Entzug verhindern weitere autorisierte Starts. Vorhandene Kopien oder Anbietersitzungen werden damit nicht zurückgerufen.

**Harte Regeln (non-negotiable):**

- Device-local only. FastAPI sieht nie Grants, App-Identität, Purpose, Expiry oder Secret.
- Default off. Uninstalliert = heutiges ZK-Modell.
- Unlock required. Locked vault → Broker verweigert.
- Unknown = DENY. Prozessname ist keine Identität.
- Kein offenes localhost-HTTP ohne Auth. Kein CORS-offenes Grant-Endpoint.
- `packages/crypto` bleibt unverändert – keine neuen Envelope-Typen für dieses Modul.
- Kein Orchestrator, keine Execution-Policy. Tollgate bleibt getrennt.

**Definition of Done (Phase 4):**

- [x] Mindestens Phase A+B als Extension-UX auf bestehendem Host-Fill. (2026-08-28: `detectSetup` + Popup-Frage, Fill nur nach Klick; C–F offen)
- [ ] Phase C nur nach E07-Host-/Ursprungs-/Vaulttransfer-Abnahme verbinden; kein Material-/Env-Fallback.
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
- Kein Geräte-Treiber, kein Sidecar-Always-Allow für String-`n8n`, keine Device-Envelopes als Agent-Identität. Core-Prototyp (`decideStandingAccess`, requester signatures) ist **nicht** der laufende Broker.

---

## 3. Autorität

```text
security-boundary.md          was der Code erzwingt
        ↓
ROADMAP.md                    aktuelle E01–E09-Folge und Status
        ↓
dieses Dokument               abgeglichener Einstieg für Grok Build
        ↓
supply-chain-security.md      vorhandene Lieferkettenregeln
secret-access-layer.md        datiertes Zielbild; kein Rohmaterial-Bauauftrag
```

Wenn hier was steht, das über `security-boundary.md` hinausgeht: Defekt. Nicht umgekehrt.

---

*Zuletzt aktualisiert: 2026-08-30 (human-first: npm-Scope, F-28 already on main).*
