# 4AllPass docs

**Status:** Index. Not a spec.

A new reader should need **this page plus five links**, not twenty files.

**Lebende Roadmap (eine Datei, Status hier pflegen):** [../ROADMAP.md](../ROADMAP.md) – Grok Build liest zuerst `grok-build-plan.md`, dann die Roadmap.

| Question | Read |
|---|---|
| What is 4AllPass **today**? | [../README.md](../README.md) |
| What does the running software **enforce**? | [security-boundary.md](security-boundary.md) |
| How is the vault stored and synced? | [vault-protocol.md](vault-protocol.md), [vault-storage.md](vault-storage.md) |
| How do agents access secrets **today**? | [security-boundary.md](security-boundary.md) §7, [local-access-broker.md](local-access-broker.md) |
| How should agents access secrets **later**? | [architecture/agent-access.md](architecture/agent-access.md), [secret-access-layer.md](secret-access-layer.md) |
| What is MAIP? | [specs/maip-v0.1.md](specs/maip-v0.1.md) — experimental draft, **not implemented** |
| What do we build next? | [product-maturity.md](product-maturity.md) (v3) — code sequence done; remaining humans: stranger Mac, Apple, audit. **Later in that file:** own VPS as cloud simulation, then mobile as same-vault device. |
| What is vision, not code? | [architecture/future-architecture.md](architecture/future-architecture.md) |
| Are our **dependencies** safe? | [supply-chain-security.md](supply-chain-security.md) — pinning, provenance, SBOM, crypto-core rules |
| **Grok Build: what to do first?** | [grok-build-plan.md](grok-build-plan.md) — entry point, then supply-chain-security.md, then Phase 4 (Secret Access Layer) |
| Are we ready for the **first real user**? | [future-readiness.md](future-readiness.md) — exit strategy, crypto-agility, legal |
| Gesamtstatus / Roadmap? | [../ROADMAP.md](../ROADMAP.md) |
| How did we get here? | [entstehungslinie.md](entstehungslinie.md) |
| Where do we position ourselves? | [positioning.md](positioning.md) (today), [positioning-target.md](positioning-target.md) (far later) |
| How do we look on GitHub? | [github-sichtbarkeit.md](github-sichtbarkeit.md) |
| How do we ship signed builds? | [distribution.md](distribution.md) |
| Team mode (not now)? | [team-mode.md](team-mode.md), [team-roadmap.md](team-roadmap.md) |
| Post-quantum? | [post-quantum-roadmap.md](post-quantum-roadmap.md) |

---

## Authority (conflicts)

```text
security-boundary.md          what the running code enforces
        ↓
architecture.md               shape (client owns vault, server stores blobs)
        ↓
crypto-protocol.md
vault-protocol.md
vault-revision.md
recovery.md
ADRs
        ↓
product-maturity.md           product sequence (NOW)
architecture/future-architecture.md   vision (NOT a build license)
        ↓
README / site                 must not out-claim the docs above
```

If two documents disagree: **the higher one wins.**  
If a spec disagrees with `packages/crypto`: **the library and its tests win.**

Public copy: **Local-first. Sync optional. Server deiner Wahl. Kein verpflichtender Cloud-Dienst.**  
Desktop is the **client**. Self-hosting is a **storage placement**. Do not mix those words.

---

## Implemented vs later

| Topic | Today | Later (do not build on “weiter”) |
|---|---|---|
| Vault crypto | Client AES-GCM, envelopes | Unchanged |
| Desktop | Tauri + local SQLite | Same client, optional remote URL |
| Self-host FastAPI | Exists (compose) | URL field in the client |
| Managed hosting | **Not offered** | Same protocol, different endpoint |
| Autofill | Chromium + Firefox + Safari wrapper | Shadow DOM / multi-step later |
| Agent access | String `n8n` + pairing token + human Allow | MAIP verify, then local policy, signed tokens (Phase 4) |
| Agent identity | **Not cryptographic** | [MAIP v0.1](specs/maip-v0.1.md) experimental |
| Grant | `handoff: "raw_secret"`; TTL does not un-know a copy | Mediated proxy ([secret-access-layer.md](secret-access-layer.md)) |
| Multi-device sync | Snapshot CAS, 409, pin | No CRDT; 409 → reload |
| Mobile apps | 0 % | Same vault protocol |
| Team Mode | Spec only | Not PAM |
| Supply chain | Lockfiles exist; audit/SBOM not yet enforced in CI | [supply-chain-security.md](supply-chain-security.md) |

---

## Keep (do not “consolidate away”)

Crypto and security records stay: `crypto-protocol.md` (modules in `crypto/`), `vault-revision.md`, `webauthn-prf.md`, `recovery.md`, `threat-model.md`, `adversarial-review*.md` (modules in `reviews/`), `audit-scope.md`, `test-vectors*`, `architecture/adr/`, `supply-chain-security.md`, `future-readiness.md`, `grok-build-plan.md`, `secret-access-layer.md`.

Far-later concepts stay as **one file each**, marked not implemented: `team-mode.md`, `capability-interface.md`, `secret-access-layer.md`, `post-quantum-roadmap.md`.

**Regel ab jetzt:** Keine neuen Plan- oder Roadmap-Dateien. Alles in `../ROADMAP.md` oder die bestehende Spec. Redundante Pointer-Dateien wurden entfernt (2026-08-28).
