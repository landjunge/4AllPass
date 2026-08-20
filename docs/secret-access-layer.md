# Secret Access Layer

**Status:** Concept only. Far later. Protocol v1 is unchanged.  
**Date:** 2026-08-20  
**Not this document:** a broker binary, MCP server, FastAPI grant API, env-var export, clipboard watcher, or an orchestrator.

Companion: `provider-service-vision.md` (vault *shape*), `positioning-target.md` (category *if this ships*), `security-boundary.md`, `autofill-extension.md`, `.cursor/skills/4allpass/references/improve.md`.  
Trackers: [#67](https://github.com/landjunge/4AllPass/issues/67) (this layer), [#65](https://github.com/landjunge/4AllPass/issues/65) (Provider / Account / Secret), [#59](https://github.com/landjunge/4AllPass/issues/59) (clipboard *ingest*; MCP as a future *client*).

---

## 1. What this is

API-key management, provider auto-detection, a local broker, and app capabilities are **one module**, not four features.

Name: **Secret Access Layer**.

It is **not** “4AllPass automatically gives apps passwords.” That direction is a defect.

It is a **capability / approval** model:

> An application may receive Secret X only after an explicit grant.

4AllPass is **not an orchestrator**. It does not decide “Agent A may run this workflow.” It only answers:

> **Agent A has an explicit capability on Secret X** (optional expiry).

```text
4AllPass
│
├── Providers          (see provider-service-vision.md)
├── Credentials        (Accounts + Secrets)
├── Applications       n8n · Claude Code · Gnom-Hub · Terminal
└── Permissions        n8n → OpenAI Production
                       Gnom-Hub → Anthropic Dev
                       Claude Code → GitHub
```

The FastAPI server is **not** in this picture. Grants live on the device, in ciphertext after unlock. A remote host that indexed “n8n may read OpenAI” would learn infrastructure from metadata.

---

## 2. Honest limits (read before any design)

1. **Once a process has the secret, 4AllPass cannot un-know it.** n8n, an agent, or a shell can copy it to disk, logs, or another API. Broker expiry and “Allow once” stop *future* handoffs. Real revoke of a leaked `sk-…` is **rotating the upstream credential**. The UI must say that.
2. **Unknown application = DENY.** Trusted vs unknown is a first-class distinction, not a badge.
3. **Process name is not identity.** `n8n` as a string is spoofable. Real binding needs OS identity (code signature / bundle id on macOS; equivalent elsewhere is weaker, especially Docker). Until identity is bound, do not ship a broker that any local client can call.
4. **Open localhost HTTP is a website attack.** A page, extension, or other process on the same machine must not be able to `fetch('http://127.0.0.1:…')` and receive a secret. No CORS-open grant endpoint. No unauthenticated broker.
5. **Do not `export OPENAI_API_KEY=…` as the default path.** Environment, `ps`, shell history, crash dumps, and debug tools all see it. Prefer in-memory handoff or an OS secret-bridge. Env injection is an explicit, ugly last resort the UI must warn about.
6. **The broker is a new trusted process.** It holds plaintext after vault unlock. Default **off**. Who does not install it has today’s ZK (PWA + extension only).
7. **`packages/crypto` does not change** for this module. Same envelopes. Same server never sees plaintext, VK, DK, DWK, PRF, grants, or app identity.

---

## 3. Phases (do not skip ahead)

### Phase A — Auto-detection (suggest, never fill)

Recognize *what* the user is setting up. Then **ask**.

```text
n8n → Credential → “OpenAI API Key”
  → Provider: OpenAI · type: API Key · target: n8n
  → “Passenden OpenAI-Key aus 4AllPass verwenden?”  [Auswählen] [Abbrechen]

https://github.com/login
  → GitHub · username + password

ftp.example.com
  → FTP/SFTP · host · matching account

Cloudflare Dashboard
  → Cloudflare · matching account
```

Detection must use **several** signals, not a single env name:

```text
application identity
+ provider metadata
+ credential / field name
+ domain
+ protocol
+ user selection
```

`OPENAI_API_KEY` alone is too easy to spoof. High confidence wants something like `n8n` + `api.openai.com` + field schema + user pick.

### Phase B — Browser secret fill

n8n (or GitHub, or Cloudflare) in the **browser**:

```text
page field → extension → user approval → paste/fill
```

Today’s MV3 extension already fills username/password on **host match after unlock** (`docs/autofill-extension.md`). Phase B is provider-aware *suggestion* on top of that, still with a click. Do not reimplement autofill. Do not auto-submit.

### Phase C — Local Secret Broker

Local apps must **not** poke the PWA origin or the FastAPI API for plaintext.

```text
application  →  4AllPass Secret Broker (localhost, after unlock)
                     │
                     ▼
              encrypted vault (same envelopes)
```

A request looks like policy, not a key dump:

```json
{
  "provider": "openai",
  "credential": "production",
  "purpose": "n8n"
}
```

The broker **does not answer with the secret**. It shows:

```text
n8n requests a secret
OpenAI / Production
Requested by: n8n
Purpose: workflow execution

[Allow once]  [Deny]
```

Only Allow releases bytes, in-memory.

### Phase D — Application identity

Name the caller as a first-class object: n8n, Claude Code, Gnom-Hub, Terminal, unknown.

```text
n8n                 ✓ Trusted
unknown-process     ⚠️ Unknown — default DENY
```

Ship D before any “always allow for this app.” Without D, “always allow n8n” is “always allow whoever claims to be n8n.”

### Phase E — Capabilities

Not “n8n may OpenAI,” but a grant record:

```text
Application: n8n
Provider:    OpenAI
Credential:  Production
Purpose:     workflow execution
Permission:  read secret
Expires:     2026-08-20 23:00
```

Or a per-app matrix (still local, still ciphertext):

```text
n8n
 ├── OpenAI Production      ✓
 ├── Anthropic Production   ✓
 ├── GitHub                 ✗
 └── AWS Production         ✗
```

“Allow 30 minutes” means the broker may cache the **grant**, not that the secret should be written to disk.

### Phase F — Agent secrets

```text
Gnom-Hub → Agent A → capability: Anthropic / Project-X / API → 15 minutes → REVOKED
```

The agent never receives the whole vault. Expiry is broker policy. Same honest limit as §2.1: the 15-minute window is “we will not hand it out again,” not “the model forgot the key.”

A later native n8n credential type (“4AllPass → OpenAI Production”) is a Phase C+D client. The workflow UI must not display the secret.

---

## 4. How this sits next to other parked ideas

| Piece | Role | Tracker |
|---|---|---|
| Provider / Account / Secret | What is stored (templates, custom fields, graph) | `#65`, `provider-service-vision.md` |
| Secret Access Layer | Who may *read* which Secret, after approval | `#67`, this file |
| Clipboard capture | *Ingest* into the vault (suggest, don’t auto-save) | `#59` |
| MCP / IDE / n8n agent | A **client** of the broker, default off | `#59` points here |

Do not build four parallel injection paths.

---

## 5. Zero-Knowledge rules (non-negotiable)

If this is ever implemented:

1. **Device-local only.** The FastAPI process never sees grants, app identity, purpose, expiry, or the secret.
2. **Default off.** Plus shell or optional binary. Uninstalled = today’s PWA/extension threat model.
3. **Unlock required.** Locked vault → broker refuses. Idle-lock applies (same clock as the extension).
4. **Approval required.** No silent fill to an app. “Always allow” needs Phase D identity.
5. **Unknown = DENY.**
6. **No env export as the happy path.**
7. **No orchestrator.** No workflow engine, no “run agent A,” no server-side policy language.
8. **Do not mix** with clipboard auto-save. Ingest ≠ egress.

---

## 6. Triggers to reopen this file

- Community vote, or a maintainer-defined **Plus shell**, after the security freeze.
- Explicit request to implement the **Secret Access Layer** (not “weiter”, not “API keys”, not “MCP”, not “n8n”).
- Phase B only: a small extension UX on top of existing host fill, still click-to-fill — still not a broker.

Until then the honest line is: **v1 autofill is host-match after unlock in the extension; there is no local broker, no grant matrix, and no agent capability.** Public positioning stays `positioning.md`; the “personal secret access control” story is `positioning-target.md` and must not leak onto the README.

No code in this repository implements a Secret Broker, application identity, or grant records.
