# Grok Build – Ausführungsplan (Supply-Chain)

> **Status:** aktiv. Dieses Dokument ist der **Einstiegspunkt für Grok Build**.
> Lies es zuerst, dann `docs/supply-chain-security.md`.

---

## 0. Sofort-Anweisung (Pflicht)

Du bist Grok Build. Deine erste Aufgabe in diesem Repo:

**Supply-Chain-Sicherheit sofort umsetzen** – kein Warten, kein „später", keine Diskussion.

**Arbeitsreihenfolge (strikt):**

1. Lies `docs/grok-build-plan.md` (dieses Dokument).
2. Lies `docs/supply-chain-security.md` komplett – das ist der ausführbare Plan mit Phasen 1–3.
3. Lies `docs/security-boundary.md` (Trust-Boundaries, Crypto-Kern).
4. Lies `docs/audit-scope.md` Modul **M6**.
5. Inventarisiere den aktuellen Stand:
   - `Cargo.lock`, `package-lock.json`, `requirements*.txt`, `libs.versions.toml`
   - `.github/workflows/ci.yml`
   - `packages/crypto` Dependency-Baum
6. Setze **Phase 1** um: Pinning + CI-Audits. Ein Commit pro logischer Einheit.
7. Setze **Phase 2** um: Crypto-Kern-Audit + Minimalismus.
8. Setze **Phase 3** um: SBOM + Incident-Runbook.
9. Aktualisiere die Checkliste in `docs/supply-chain-security.md` §6: ☐ → ☑ mit Datum und Notiz.
10. Öffne **keinen** PR, der die CI rot macht. Finding blockiert CI → fixen oder als `allow` mit Begründung dokumentieren.

**Definition of Done:**

- [ ] Alle Lockfiles committed und in CI enforced (`--locked`, `npm ci`).
- [ ] `cargo audit`, `cargo deny`, `npm audit --audit-level=high`, `pip-audit` laufen in CI und schlagen bei high/critical fehl.
- [ ] `packages/crypto` hat keine Netzwerk- oder UI-Abhängigkeiten.
- [ ] SBOM-Erzeugung ist im Release-Workflow vorhanden.
- [ ] Checkliste §6 ist aktuell.
- [ ] Findings (falls vorhanden) in `docs/reviews/attack-vectors.md` dokumentiert.

**Nicht tun:**

- Keine großen Refactors außerhalb der Supply-Chain.
- Keine neuen Features.
- Keine Secrets committen.
- Keine „while we're at it“-Aufräumarbeiten.

---

## 1. Verwandte ausführbare Pläne (Grok Build)

| Plan | Datei | Status |
|---|---|---|
| Supply-Chain (jetzt zuerst) | `docs/supply-chain-security.md` | offen – umsetzen |
| Android-Skelett | `docs/android-skeleton-grok-build.md` | bereit |
| iOS-Skelett | `docs/ios-skeleton-grok-build.md` | bereit |
| Future Readiness | `docs/future-readiness.md` | offen |

**Reihenfolge:** Supply-Chain zuerst, dann Mobile (Android vor iOS).

---

## 2. Autorität

```text
security-boundary.md     was der Code erzwingt
        ↓
supply-chain-security.md  Regeln für die Lieferkette (ausführbar)
        ↓
dieses Dokument          Einstieg für Grok Build
```

Wenn hier was steht, das über `security-boundary.md` hinausgeht: Defekt. Nicht umgekehrt.

---

*Zuletzt aktualisiert: 2026-08-28.*
