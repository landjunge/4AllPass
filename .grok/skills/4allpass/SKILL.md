---
name: 4allpass
description: >
  Gate for ANY 4AllPass work — code, review, tests, architecture, vault,
  autofill, broker, crypto. Trigger on 4AllPass, Tresor, envelopes, Argon2id,
  WebAuthn PRF, CAS, PWA, Extension, Desktop. Do not start 4AllPass coding or
  review without this skill. For "weiter", "nächster Schritt", or "improve"
  also load 4allpass-next.
---

# 4AllPass

Device-centric ZK vault. Humans: effortless auth (import + reliable autofill).
Machines: **controlled** access (Allow/Deny). v1 after Allow still copies a
**raw secret**; TTL does not un-know a copy. Not a nicer Bitwarden. Not Tollgate.

**What runs:** `docs/security-boundary.md`. Specs win over PR text. If code and
`packages/crypto` disagree, the library and its tests win.

For „weiter / nächster Schritt / improve / was jetzt“: stop here and follow
[../4allpass-next/SKILL.md](../4allpass-next/SKILL.md).

## Before you touch anything

1. Read `docs/security-boundary.md`.
2. Crypto / envelopes / revision / recovery / PRF: matching spec + `docs/threat-model.md`.
3. Open [references/invariants.md](references/invariants.md) and
   [references/claims.md](references/claims.md). Do not ship a broken invariant
   or an over-claim.

## Three proofs (never mix them)

| Proof | Question | Mechanism |
|---|---|---|
| Authentication | This is account X | Email + **account** password → Bearer session |
| Authorization | Account X owns vault Y | `get_owned_vault` → foreign ids are **404** |
| Crypto | Snapshot is authentic; only an authorized client can decrypt | Client AES-GCM, envelopes, sealed manifest |

The account password cannot unwrap a Vault Key. A session token only authorizes **storage**.

The server must never receive or derive: Master Password, VK, DK, DWK, PRF output, or plaintext entries.

## Layers

| Path | May do | Must not do |
|---|---|---|
| `packages/crypto` | Protocol v1. Pure functions. | UI, network, authenticator I/O |
| `packages/webauthn` | PRF > largeBlob > UV-gated store | Vault crypto (call `@4allpass/crypto`) |
| `backend` | Accounts, ownership, snapshot CAS, opaque blobs | Decrypt, “verify” PRF, invent VK |
| `frontend` | All cryptography, PWA UX | Trust server metadata as crypto proof |
| `docs/` | Authoritative specs | Drift from code — update both in the same PR |

## How to review

Follow [references/review.md](references/review.md). Use bundled `/review` for
the PR/diff mechanics; seed the reviewer with that playbook. Default stance:
malicious server + hostile store.

## How to code

Follow [references/coding.md](references/coding.md).

```sh
npm test
npm run typecheck
npm run test:webauthn
cd backend && pytest
```

## Standing (UI / language)

- DE und EN on every user-facing surface in the same PR.
- Logo is 4AllPass only: Elster + goldener Schlüssel + Schriftzug.
- Vault UI: `DESIGN.md`, `docs/ui-map.md`, `frontend/src/components/vault/`. Golden-Magpie, not Gnom-Hub tokens.

## Do not

Rewrite crypto. Implement MAIP. FastAPI token mint. Tollgate merge. Auto-publish launch posts. Native mobile before PWA. Fifth parallel branch for the same theme.
