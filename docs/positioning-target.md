# Target positioning (far later)

**Status:** Concept only. Not current product claims.  
**Date:** 2026-08-20  
**Not this document:** a README rewrite, scores in `comparison.md`, a broker, native mobile, or an audit report.

Companion: `positioning.md` (what we may say **today**), `comparison.md` (only ✅ that `security-boundary.md` carries), `provider-service-vision.md`, `secret-access-layer.md`.  
Trackers: [#65](https://github.com/landjunge/4AllPass/issues/65), [#67](https://github.com/landjunge/4AllPass/issues/67).

If a sentence here appears as an Ist-Zustand on the README or website, that is a **defect**.

---

## 1. Today vs target category

**Today (honest):** a device-centric, self-hosted Zero-Knowledge password manager. Not “a nicer Bitwarden.” See `positioning.md`.

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

---

## 2. Three access planes

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

---

## 3. Stack (target)

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

---

## 4. Who you would then compete with

Two classes, not one:

| Class | Examples | Their strength | 4AllPass must not fake |
|---|---|---|---|
| Password manager | 1Password, Bitwarden, Proton Pass | Human → site | Their team/org surface, years of autofill polish |
| Secret / identity infra | HashiCorp Vault, Infisical, Doppler, cloud secret stores | Server/app secrets at scale | Dynamic DB creds, enterprise policy engines, HSM fleets |

Advantage only if the layer is real: **one local-first product** that covers person + app + agent without a second protocol.

---

## 5. Conditional scorecard (not current)

These numbers are a **target if and only if** the matching function is finished, tested, and (for crypto/ZK/device) independently audited. They are **not** a rating of main today. Copying them into `comparison.md` is a defect.

| Area | Target *if shipped* | Today (honest) |
|---|---:|---|
| Cryptography | 9.5 | Strong v1 (AES-256-GCM, Argon2id, envelopes) — **no third-party audit** |
| Zero-Knowledge architecture | 9.5 | Server is storage; claims live in `security-boundary.md` |
| Device security | 9.5 | PRF unlock + hard revoke on main; freeze still wants two-browser proof |
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

---

## 6. What must exist before anyone quotes §1 in public

All of:

- Adversarial tests still green; threat model current
- Reproducible builds
- Independent security audit (`docs/audit-scope.md`)
- Browser fill that people actually use; mobile if you claim 9/10 mobile
- Provider detection that is multi-signal, not env-name guessing
- Application / agent capabilities with Unknown = DENY
- UX that makes “Allow once / Deny / expires” obvious
- The honest limit in `secret-access-layer.md` §2 still in the UI: 4AllPass cannot un-know a secret an app already received; rotate the upstream key

Until then, the public line stays `positioning.md`.

---

## 7. Triggers to reopen this file

- Secret Access Layer (`#67`) or Provider templates (`#65`) are actually in implementation.
- Someone wants to put “personal secret access control” on the README — only after §6.

Do not start that work on “weiter.”
