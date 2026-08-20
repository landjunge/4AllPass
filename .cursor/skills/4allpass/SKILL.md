---
name: 4allpass
description: >
  Use this skill for ANY 4AllPass work — code review, PR review, implementing
  features, fixing bugs, writing tests, planning improvements, or discussing
  architecture. Trigger on 4AllPass, schlankpass, vault, envelopes, Argon2id,
  WebAuthn PRF, device revoke, snapshot CAS, packages/crypto, backend, PWA.
  Covers how to review (adversarial, not cosmetic), how to code (layer rules),
  and what to improve next (honest security-boundary gaps). Do not start
  4AllPass coding or review without this skill.
---

# 4AllPass

Device-centric, self-hosted Zero-Knowledge password manager. Not “a nicer Bitwarden.”

Specs in `docs/` win over comments and PR descriptions. If code and `packages/crypto` disagree, the library and its tests win.

## Before you touch anything

1. Read `docs/security-boundary.md` (what the **running** backend + PWA actually enforce).
2. If the change is crypto, envelopes, revision, recovery, or PRF: also read the matching spec (`crypto-protocol.md`, `vault-revision.md`, `webauthn-prf.md`, `recovery.md`) and `docs/threat-model.md`.
3. Open [references/invariants.md](references/invariants.md). Do not ship a change that violates one.

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

Follow [references/review.md](references/review.md). Default stance: **malicious server + hostile store**, same method as `docs/adversarial-review.md`.

A review is not a style pass. Reproduce or argue a concrete attack, or say “no finding.” Over-claims (“DELETE device erases the key”, “server verified this passkey”) are defects.

Always use this review template:

```markdown
## Verdict
ship | ship-with-nits | block

## Claims vs reality
- What the PR/docs claim
- What the code actually does
- Over-claims to fix

## Findings
### F-n — title · severity · new|regression
Attack, impact, fix, test that would fail if reverted.

## Invariants
- [ ] still held / [ ] broken (which)

## Tests I would add
## Improve next (only if in scope)
```

## How to code

Follow [references/coding.md](references/coding.md).

- Open paths take **caller expectations** (`expectType`, `entryId`, `vaultId`…) and compare **before** decrypt. Self-referential AAD is not enough.
- `revision` is a cryptographic statement via the sealed manifest, not a server integer.
- `DELETE /devices` is `metadata_only`. Soft revoke = next snapshot without that envelope. Hard revoke = `vaultKeyVersion`++. The PWA rotates via `hardRevokeDevice`.
- WebAuthn rows may be `cose_verified` (ceremony signature only). Do not imply the server verified PRF.
- Foreign vault/device ids → 404, never 403.
- Snapshot write: `SELECT … FOR UPDATE`, CAS `expectedRevision`, reject `vaultKeyVersion` decrease, 409 on conflict.
- New crypto behavior needs an adversarial test in the matching class (`adversarial-aead|identity|freshness|kdf-prf|toctou`).
- Same PR updates the spec if the claim surface changes.

```sh
npm test                    # KATs + adversarial
npm run typecheck
npm run test:webauthn
cd backend && pytest
```

## How to improve the product

Follow [references/improve.md](references/improve.md). Prefer the next **honest** milestone over new features.

Current recommended order:

1. Reproducible frontend/extension builds (`docs/reproducible-builds.md`)
2. Offline: last good snapshot stays on the device; pin still applies
3. Then Selective Sharing UI — after the above, not before

Hard revoke, DK-mirror CAS, server-issued challenges, COSE ceremony verification, Chromium autofill, Bitwarden/CSV import, and recovery-kit copy are **on main**. Do not reimplement them.

Do not start orgs, social-login-as-crypto, native apps, or “passkey store as vault” before the above.

## Open work already in flight

Check GitHub before duplicating. Stale branches to ignore: `#8` (adversarial crypto, superseded), old `#15`/`#16`/`#12` (landed via `#26`/`#28`).

Do not open a fifth parallel branch for the same theme.
