# 4AllPass — Positionierung

**Zielgruppe:** Technisch versierte Einzelpersonen und kleine Teams, die volle Datenkontrolle wollen — Self-Hoster, die Bitwarden/Vaultwarden nutzen aber UI oder Autofill leid sind, oder die 1Password/Proton Pass mögen, aber nicht von einem Cloud-Anbieter und dessen Preispolitik abhängen wollen.

**Öffentlich (2026-08-23):**

> A local-first password vault that lets you securely share limited access with AI agents.

DE: Lokaler Passwort-Tresor. Begrenzt Zugang für KI-Agenten, wenn du das willst.

Einstieg: Browser → Tresor → Autofill ([`browser-sync.md`](browser-sync.md)). Agent Access bleibt **Advanced** (Access-Tab), nicht der erste Bildschirm. Nicht „besserer Bitwarden“.

**Heute (Vault, ehrlich):**

> Deine Geräte besitzen den Vault — kryptografisch, nicht nur organisatorisch. Local-first. Sync optional. Server deiner Wahl. Kein verpflichtender Cloud-Dienst. Desktop = Client. Self-host = Ablage. Zero-Knowledge, offenes Protokoll.

Die Chance ist beides: Device-Centric (PRF → DWK → DK → VK) **und** scoped/TTL access ohne dauerhaften Key beim Agenten. Der Server bleibt ein Blob-Store. 4AllPass hängt nicht an Tollgate.

**Nicht gegen 1Password Unified Access / EAM antreten.** Die haben Cloud, verifizierte Machine-Identities, JIT, Attribution, Mobile, Audit. Unser Feld: **lokal, ZK, kein Account bei uns, FastAPI mintet keine Tokens.** Agent-Zugang ist die Haltung „ohne uns zu vertrauen“, nicht Feature-Parität. Identität ist heute ein String + Pairing-Token — ehrlich, nicht OS-Binding.

---

## Was Nutzer an etablierten Anbietern stört

Auswertung von Nutzerfeedback (Trustpilot, Capterra, G2, Reddit-Zusammenfassungen) und Fachvergleichen, Stand August 2026.

| Anbieter | Geschätzt | Stört |
|---|---|---|
| **Bitwarden** | Preis-Leistung, Open Source, Self-Hosting | UI gilt als klobig; Preiserhöhung 2026; kein Recovery bei vergessenem Master-Passwort; Extension teils langsam; Login-Zuordnung nur nach Domain |
| **1Password** | UX-Goldstandard, starke Team-Funktionen | Teuer für Einzelpersonen/kleine Teams; Enterprise-Gewicht für Privatnutzer |
| **Proton Pass** | Privacy-first, Gratis-Tarif, moderne Optik | Autofill unzuverlässig; schwache Favicons; Emergency Access fehlt bzw. nur in höheren Tarifen |
| **Self-Hosting** (Vaultwarden & Co.) | Volle Kontrolle | Sicherheit hängt am eigenen Server; Single Point of Failure ohne Backup-Konzept |

Gemeinsamer Nenner:

1. Autofill, das zuverlässig funktioniert
2. Moderne Oberfläche trotz Sicherheitsfokus
3. Faire, transparente Preise
4. Bei technikaffinen Nutzern: echte Datenkontrolle, ohne Zuverlässigkeit zu opfern

---

## Der Einwand, den 4AllPass entkräften muss

„Self-Hosting ist unsicherer/unzuverlässiger als ein gehosteter Dienst.“

Antwort, die **im Produkt sichtbar** sein muss, nicht nur im Marketing:

- Recovery Key beim Vault-Setup, kein Server-Reset, kein E-Mail-Recovery (`docs/recovery.md`).
- Docker-Compose für Postgres + Redis + Backend.
- Öffentliches Threat Model, Adversarial Review, Testvektoren.
- Ehrliche Security Boundary: was die laufende Software wirklich erzwingt (`docs/security-boundary.md`).

---

## Was wir heute behaupten dürfen

- Local-first ist der Kern: kein verpflichtender Cloud-Dienst. Self-Hosting ist möglich, nicht Pflicht. Hosted später dasselbe Protokoll ([`vault-storage.md`](vault-storage.md)).
- Der Server speichert nur undurchsichtige Envelopes. Account-Passwort entschlüsselt den Vault nicht.
- Argon2id, AES-256-GCM, zufälliger Vault Key, Recovery Envelope, WebAuthn-PRF-Unlock sind im Client implementiert.
- Specs und KATs liegen öffentlich im Repo.

## Was wir heute nicht behaupten dürfen

- Autofill-Zuverlässigkeit in allen Browsern (Chromium, Firefox, macOS Safari existieren; iOS/Android native nicht).
- Live item-sharing to another person’s device key (v1 is an encrypted file plus share key only).
- Unabhängiges Drittaudit.
- „DELETE Gerät löscht den Schlüssel“ — Soft-Revoke ist `metadata_only`; Hard-Revoke rotiert den Vault Key in der PWA.
- Production n8n node, OS application identity, FastAPI token minting, “we posted this everywhere.” The Access tab **does** have a local two-minute demo (`docs/two-minute-demo.md`) and a launch article (`docs/your-ai-agent-doesnt-need-your-api-keys.md`). Same-origin `BroadcastChannel` `4allpass-access-v1`, not FastAPI. FastAPI gibt keine Tokens aus. Post-Entwürfe: `docs/launch-posts.md` — nicht automatisch veröffentlicht.

Vergleichstabelle: [`comparison.md`](comparison.md).

---

## Far later — Target positioning (concept only)

**Status:** Concept only. Not current product claims.  
**Date:** 2026-08-20  
**Not this section:** a README rewrite, scores in `comparison.md`, a broker, native mobile, or an audit report.

Companion: this file (what we may say **today**), `comparison.md` (only ✅ that `security-boundary.md` carries), `provider-service-vision.md`, `secret-access-layer.md`, `capability-interface.md` (do not merge Tollgate).  
Trackers: [#65](https://github.com/landjunge/4AllPass/issues/65), [#67](https://github.com/landjunge/4AllPass/issues/67), [#70](https://github.com/landjunge/4AllPass/issues/70).

If a sentence here appears as an Ist-Zustand on the README or website, that is a **defect**.

### Today vs target category

**Today (honest):** a device-centric, self-hosted Zero-Knowledge password manager. Not “a nicer Bitwarden.” See above.

**Target, only if Provider templates and the Secret Access Layer actually ship, are tested, and are audited:**

> 4AllPass gives people, applications, and AI agents **controlled access** to their secrets — without handing over the vault.

That is a **different category**, not a higher score in the same password-manager table.

```text
Password Manager
        +
Personal Secret Vault
        +
Application Secret Access
        +
AI-Agent Capabilities
```

local-first. One device-owned vault. Same envelopes.

Working name for that category: **personal secret access control**. Not HashiCorp-for-home. Not “1Password but with n8n.”

### Three access planes

```text
1. Human  →  4AllPass  →  website / mail / FTP / domain
2. App    →  4AllPass  →  API  (n8n, Claude Code, Terminal)
3. Agent  →  4AllPass  →  API  (Gnom-Hub Agent A, 30 minutes, one provider)
```

Classical password managers are strong on plane 1.

Classical secret managers (Vault, Infisical, Doppler, AWS Secrets Manager) are strong on **server → application → secret** for teams. They are not built for:

> my GitHub account, my domain, my mailbox, my OpenAI key, and my n8n workflow — as a person.

The gap is **personal** infrastructure, not enterprise rotation at 10k services.

4AllPass does not need their full feature set. It must not become an orchestrator (`secret-access-layer.md` §1).

### Stack (target)

```text
                         4AllPass
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
       Identity          Vault            Secrets
          │                 │                 │
     Passwords          Passkeys          API Keys
     WebAuthn           TOTP              Tokens
     Sessions           Notes             SSH Keys
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
                    Secret Access Layer
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
       Browser          Applications        Agents
                            │
                       Capability
                  Provider + Secret
                      Scope + TTL
```

Provider (kind + named profile) is the **data model**. It is more important than “API keys” as a feature: Website, Email, Domain, Hosting, FTP, Cloud, Git, Database, API, Custom — then Credential — then Access Policy.

```text
n8n
 ├── OpenAI Production    Scope: API            TTL: 30 min
 └── GitHub Deploy        Scope: repository-X   TTL: 10 min
```

The agent does not get “here is your password manager.” It gets **one capability for one task**.

### Who you would then compete with

Two classes, not one:

| Class | Examples | Their strength | 4AllPass must not fake |
|---|---|---|---|
| Password manager | 1Password, Bitwarden, Proton Pass | Human → site | Their team/org surface, years of autofill polish |
| Secret / identity infra | HashiCorp Vault, Infisical, Doppler, cloud secret stores | Server/app secrets at scale | Dynamic DB creds, enterprise policy engines, HSM fleets |

Advantage only if the layer is real: **one local-first product** that covers person + app + agent without a second protocol.

### Conditional scorecard (not current)

These numbers are a **target if and only if** the matching function is finished, tested, and (for crypto/ZK/device) independently audited. They are **not** a rating of main today. Copying them into `comparison.md` is a defect.

| Area | Target *if shipped* | Today (honest) |
|---|---:|---|
| Cryptography | 9.5 | Strong v1 (AES-256-GCM, Argon2id, envelopes) — **no third-party audit** |
| Zero-Knowledge architecture | 9.5 | Server is storage; claims live in `security-boundary.md` |
| Device security | 9.5 | Hard revoke on main (two Playwright profiles). Desktop PRF in WKWebView is **unproven** |
| Vault integrity | 9.5 | Sealed manifest + CAS |
| Recovery | 9 | Recovery key + kit; no server reset |
| WebAuthn | 9 | PRF > largeBlob > UV-gated; COSE is ceremony only |
| Browser | 9 | Chromium + Firefox + macOS Safari wrapper; **not iOS/Android native** |
| Password manager | 9 | Login list + fill; not yet Provider templates |
| API / secret management | 9 | **Not shipped** (SAL `#67`) |
| Application access | 9 | **Not shipped** |
| Agent secret access | 9 | **Not shipped** |
| UX | 8.5 | Usable PWA; not 1Password |
| Mobile | 9 | **Not shipped** (native Autofill later) |
| Production | 9 | Self-host compose; not “years in production” |

Even at the target: **not automatic market leader.** Users, ecosystem, and production hardening take years. The claim would be: comparison with established products becomes *technically meaningful*.

Two honest product levels, if the freeze and later work land:

| If you only finish the password manager | Very good open-source security project |
|---|---|
| If you also ship a clean Secret Access Layer | A distinct concept, more interesting than “yet another password manager” |

The interesting combination is **Provider → Credential → Capability → TTL → Application/Agent**, not twenty more password-manager features.

If Tollgate and Gnom-Hub stay in the picture, the *stack* is personal / local AI security — still three products:

```text
Identity + Secrets     4AllPass     Secret Authority
Policy + Budget        Tollgate     Execution Authority
Agents                 Gnom-Hub     Orchestration
```

Do not fuse them. The join is a small Capability (`capability-interface.md`). Human website fill never needs Tollgate.

### What must exist before anyone quotes the target category in public

All of:

- Adversarial tests still green; threat model current
- Reproducible builds
- Independent security audit (`docs/audit-scope.md`)
- Browser fill that people actually use; mobile if you claim 9/10 mobile
- Provider detection that is multi-signal, not env-name guessing
- Application / agent capabilities with Unknown = DENY
- UX that makes “Allow once / Deny / expires” obvious
- The honest limit in `secret-access-layer.md` §2 still in the UI: 4AllPass cannot un-know a secret an app already received; rotate the upstream key

Until then, the public line stays the “today” section above.

### Triggers to reopen this section

- Secret Access Layer (`#67`) or Provider templates (`#65`) are actually in implementation.
- Someone wants to put “personal secret access control” on the README — only after the checklist above.

Do not start that work on “weiter.”
