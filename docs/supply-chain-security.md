# Supply-Chain-Sicherheit

> Status: **offen – jetzt umsetzen.** Diese Regeln gelten für **alle** neuen und bestehenden Abhängigkeiten – Rust (Cargo), JavaScript (npm), Python (backend), Tauri, Mobile (Kotlin/Swift).
>
> **Warum das hier steht:** 4AllPass ist ein Tresor. Jede Bibliothek, die du einziehst, ist ein Angriffsvektor. Ein kompromittierter Maintainer, ein Dependency-Confusion-Angriff, ein bösartiger Transitive-Dep – und fremder Code läuft in deinem Vault. Das ist kein theoretisches Risiko, das ist die häufigste Angriffsform der letzten Jahre.
>
> **Höhere Autorität:** `security-boundary.md` (was der Code erzwingt) und `threat-model.md` (wer angreift). Dieses Dokument definiert die *Regeln für die Lieferkette*. Wenn hier was steht, das über die Security-Boundary hinausgeht, ist das ein Defekt – nicht umgekehrt.
>
> **Ausführungsmodus:** Dieses Dokument ist ein **ausführbarer Plan für Grok Build**. Lies es von oben nach unten und setze jeden Schritt um. Keine Diskussion, kein „optional“, kein „später“. Wenn ein Schritt blockiert (fehlende Datei, unklare Dep), dokumentiere das als Finding und geh weiter.
>
> **Einstieg:** Starte über `docs/grok-build-plan.md` – das ist der offizielle Einstiegspunkt für Grok Build. Gesamtstatus: `ROADMAP.md`.

---

## 0. Grok-Build-Anweisung (Pflicht, zuerst lesen)

Du bist Grok Build. Deine Aufgabe: **Supply-Chain-Sicherheit in 4AllPass sofort umsetzen.**

**Arbeitsreihenfolge (strikt):**

1. Lies `docs/grok-build-plan.md` (Einstiegspunkt).
2. Lies `ROADMAP.md` (lebende Roadmap).
3. Lies `docs/supply-chain-security.md` (dieses Dokument) komplett.
4. Lies `docs/security-boundary.md` §§ zu Crypto-Kern und Trust-Boundaries.
5. Lies `docs/audit-scope.md` Modul M6.
6. Inventarisiere den aktuellen Stand:
   - `Cargo.lock`, `package-lock.json`, `requirements*.txt`, `libs.versions.toml` (falls vorhanden)
   - `.github/workflows/ci.yml` (oder äquivalent)
   - `packages/crypto` Dependency-Baum
7. Setze **Phase 1** um (Pinning + CI-Audits). Ein Commit pro logischer Einheit.
8. Setze **Phase 2** um (Crypto-Kern-Audit + Minimalismus).
9. Setze **Phase 3** um (SBOM + Incident-Runbook).
10. Aktualisiere die Checkliste in §6 dieses Dokuments: ☐ → ☑ mit Datum und kurzer Notiz.
11. Öffne **keinen** PR, der die CI rot macht. Wenn ein Audit-Finding die CI blockiert: fixen oder als `allow`-Eintrag mit Begründung dokumentieren.

**Definition of Done für diesen Plan:**

- [ ] Alle Lockfiles committed und in CI enforced (`--locked`, `npm ci`).
- [ ] `cargo audit`, `cargo deny`, `npm audit --audit-level=high`, `pip-audit` laufen in CI und schlagen bei high/critical fehl.
- [ ] `packages/crypto` hat keine Netzwerk- oder UI-Abhängigkeiten.
- [ ] SBOM-Erzeugung ist im Release-Workflow vorhanden.
- [ ] Checkliste §6 ist aktuell.
- [ ] Ein kurzer Eintrag in `docs/reviews/attack-vectors.md` (oder neu angelegt), falls Findings aufgetaucht sind.

**Nicht tun:**

- Keine großen Refactors außerhalb der Supply-Chain.
- Keine neuen Features.
- Keine Secrets committen.
- Keine „while we're at it“-Aufräumarbeiten, die den Scope sprengen.
- **Keine neuen Plan-Dateien.** Status in `ROADMAP.md`.

---

## 1. Die vier Hebel (Pflicht)

### 1.1 Pinning – keine schwebenden Versionen

- **Cargo:** `Cargo.lock` ist committed und wird in CI mit `cargo build --locked` gebaut. Keine `^`/`~`-Abweichungen in `Cargo.toml` für Produktions-Deps.
- **npm:** `package-lock.json` committed, Install nur über `npm ci` (nie `npm install` in CI). Keine `^`/`~` in `package.json` für Runtime-Deps – exakte Versionen.
- **Python:** `requirements.txt` mit gepinnten Versionen (`==`), generiert aus `pip freeze`. Kein `pip install` ohne Lockfile in CI.
- **Mobile:** Gradle-Version-Catalog (`libs.versions.toml`) mit exakten Versionen. Keine dynamischen Ranges.

**Regel:** Wenn ein Update kommt, wird es *bewusst* eingespielt – nie automatisch über Nacht.

### 1.2 Provenance prüfen – CI blockt bei Rot

Bei jedem Push und jedem PR läuft:

| Stack | Tool | Was es prüft |
|---|---|---|
| Rust | `cargo audit`, `cargo deny` | Bekannte CVEs, unlizenzierte Deps, verbotene Quellen |
| npm | `npm audit --audit-level=high` | CVEs in der Dependency-Tree |
| Python | `pip-audit` / `safety` | CVEs in PyPI-Paketen |
| Mobile | Gradle-Dependency-Check / OSV-Scanner | CVEs in Android/iOS-Libs |

**Regel:** CI ist rot → kein Merge, kein Release. Keine Ausnahmen ohne dokumentierten Grund im PR.

### 1.3 Minimalismus – jede Dep ist ein Risiko

Bevor eine neue Abhängigkeit rein darf:

1. **Brauche ich das wirklich?** Oder schreib ich das in < 20 Zeilen selbst?
2. **Wer maintained das?** Aktiv? Bekannt? Ein Mensch oder ein Bot?
3. **Wie groß ist der Blast-Radius?** Liegt die Dep im Crypto-Pfad (`packages/crypto`) oder nur in der UI?
4. **Gibt es eine Alternative mit weniger Transitive-Deps?**

**Regel für `packages/crypto`:** So wenige Deps wie möglich. Ideal: nur das, was die Plattform nicht hergibt (z. B. `argon2`). Keine UI-Libs, keine Netzwerk-Libs im Crypto-Kern.

### 1.4 SBOM – die Liste aller Abhängigkeiten

- Erzeuge bei jedem Release eine **Software Bill of Materials** (SPDX oder CycloneDX).
- Speichere sie versioniert neben dem Release-Artefakt (z. B. `sbom.spdx.json`).
- Werkzeuge: `cargo cyclonedx`, `@cyclonedx/cdxgen`, `pip-audit --format cyclonedx`.
- **Zweck:** Wenn morgen ein Paket kompromittiert wird, weißt du in 5 Minuten, ob du betroffen bist – ohne stundenlanges Graben in `node_modules`.

---

## 2. Besondere Regeln für den Crypto-Kern

`packages/crypto` ist der heiligste Teil. Hier gelten strengere Regeln:

- [ ] **Keine Netzwerk-Abhängigkeiten.** Der Crypto-Kern darf nichts fetchen, keinen HTTP-Client, keine Telemetrie.
- [ ] **Keine UI-Abhängigkeiten.** Kein React, kein DOM, kein Styling.
- [ ] **Keine "Convenience"-Wrapper**, die intern andere Krypto-Libs aufrufen (z. B. kein `bcrypt`-Wrapper um `argon2`).
- [ ] **Jede neue Dep im Crypto-Kern braucht ein ADR** unter `docs/architecture/adr/` mit Begründung, warum es nicht anders geht.
- [ ] **Vendoring erwägen:** Für die kritischsten Deps (z. B. die Argon2-Implementierung) kannst du den Quellcode direkt ins Repo legen und aus dem Vendor-Ordner bauen. Dann kontrollierst du den exakten Byte-Stand.

---

## 3. Typosquatting & Dependency Confusion

- **Private Registry first:** Wenn du eigene Pakete veröffentlichst, nutze eine private Registry (z. B. GitHub Packages) *bevor* npm/PyPI. Sonst kann jemand ein Paket mit demselben Namen hochladen und du ziehst es unbewusst.
- **Scope prüfen:** `@4allpass/...` für eigene Pakete. Niemals unscoped Pakete mit generischen Namen (z. B. `utils`, `crypto-helpers`) aus öffentlichen Registries ohne Prüfung.
- **Checksummen:** Wo möglich, integritäts-Hashes in Lockfiles prüfen (npm macht das automatisch über `integrity`-Felder; Cargo über den Lockfile-Hash).

---

## 4. CI-Integration (Pflicht)

Neue Workflow-Schritte in `.github/workflows/ci.yml`:

```yaml
- name: Cargo audit
  run: cargo audit
- name: Cargo deny
  run: cargo deny check
- name: npm audit
  run: npm audit --audit-level=high
- name: pip-audit
  run: pip-audit
- name: SBOM erzeugen
  run: | 
    cargo cyclonedx --output sbom-cargo.cdx.json
    npx @cyclonedx/cdxgen -o sbom-npm.cdx.json
```

SBOM-Artefakte werden als Build-Artefakt hochgeladen, nicht committed (sie ändern sich mit jedem Dep-Update).

---

## 5. Incident-Response für kompromittierte Deps

Wenn ein Paket, das du nutzt, kompromittiert wird:

1. **Sofort:** CI rot schalten für dieses Paket (Pin auf letzte gute Version).
2. **Prüfen:** SBOM durchsuchen – bist du betroffen? Welche Version?
3. **Rotieren:** Falls das Paket im Crypto-Pfad lag oder Zugriff auf Secrets hatte – Vault-Key-Rotation über Hard-Revoke für alle Geräte (siehe `vault-revision.md`).
4. **Kommunizieren:** Falls Nutzer betroffen sind, über den Support-Kanal (siehe `future-readiness.md` §3) informieren.
5. **Dokumentieren:** Eintrag in `docs/reviews/attack-vectors.md`.

---

## 6. Checkliste (Status)

| Regel | Status | Notiz |
|---|---|---|
| Cargo.lock committed + `--locked` in CI | ☐ offen | |
| package-lock.json + `npm ci` | ☐ offen | |
| Python-Requirements gepinnt | ☐ offen | |
| `cargo audit` / `cargo deny` in CI | ☐ offen | |
| `npm audit` in CI | ☐ offen | |
| `pip-audit` in CI | ☐ offen | |
| SBOM bei jedem Release | ☐ offen | |
| Crypto-Kern: keine Netzwerk-/UI-Deps | ☐ prüfen | `packages/crypto` auditieren |
| Vendoring für kritischste Deps | ☐ offen | Argon2? |
| Private Registry für eigene Pakete | ☐ offen | |
| Incident-Response-Runbook | ☐ offen | |

---

## Verwandte Docs

- `ROADMAP.md` – **lebende Roadmap** (eine Datei, Status hier pflegen)
- `grok-build-plan.md` – **Einstiegspunkt für Grok Build** (lies zuerst)
- `security-boundary.md` – was der Code erzwingt
- `threat-model.md` – wer angreift
- `audit-scope.md` – was ein Auditor prüft (M6)
- `reproducible-builds.md` – Build-Determinismus (ergänzt diese Regeln)
- `future-readiness.md` – Exit, Crypto-Agility, Rechtliches
- `adversarial-review*.md` – konkrete Angriffsvektoren
- `android-skeleton-grok-build.md` / `ios-skeleton-grok-build.md` – Mobile-Pläne (ebenfalls Grok-Build-ausführbar)

---

*Zuletzt aktualisiert: 2026-08-28 – verlinkt auf lebende `ROADMAP.md`, keine neuen Plan-Dateien.*
