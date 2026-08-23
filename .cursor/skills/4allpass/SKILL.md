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

Device-centric ZK vault. Wedge: **agent credential access** (`docs/eight-week-agent-access.md`). Not “a nicer Bitwarden.” Not a Tollgate feature.

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

## Language, logo, SEO (standing)

- **DE und EN** on every user-facing surface in the same PR: README, `index.html` title/description, PWA manifest, store/GitHub About. Specs in `docs/` may stay as they are until touched.
- **SEO every time** we ship something people land on: `<title>`, `meta name="description"`, Open Graph, GitHub description + topics. Keywords match the wedge (credential access, agents, Zero-Knowledge, self-hosted) — not “better Bitwarden.”
- **Logo is 4AllPass only:** Elster + goldener Schlüssel + Schriftzug `4AllPass`. Do not mix this mark with other products. Do not drop the wordmark.

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

Current recommended order: [`docs/browser-sync.md`](../../../docs/browser-sync.md) (browser cards + review import into the existing vault). **Do not rewrite crypto.** Public line: local-first password vault; agent access is advanced. Agent/n8n is not the first screen. Do not start Safari/Windows/Linux write-back until Chrome+Firefox import is tested by a stranger. Apple notarization stays paused (`docs/product-maturity.md`). Do not fill the gap with a second Tauri, a provider list, a launch post, or tag `v0.1.2`. Optional loopback broker is pairing-token + `127.0.0.1`, not FastAPI. FastAPI never returns secrets. Do not merge Tollgate. Do not start public-key wrapping / ML-KEM unless asked. Do not auto-publish `docs/launch-posts.md`.

Hard revoke, DK-mirror CAS, server-issued challenges, COSE ceremony verification, envelope property tests, reproducible PWA/extension hashes, offline snapshot cache, Chromium autofill, Bitwarden/1Password/KeePass/CSV import, recovery-kit copy, clipboard overwrite, and v1 item-share files (`docs/sharing.md`) are **on main**. Do not reimplement them.

Do not start orgs, social-login-as-crypto, native apps, “passkey store as vault”, clipboard auto-save, a **Tollgate merge**, or FastAPI token minting. Provider templates / local broker / n8n demo follow the 8-week plan only — see `docs/eight-week-agent-access.md`. MCP is not the security interface. 4AllPass must not grow spend policy; Tollgate must not grow a vault.

## Open work already in flight

Check GitHub before duplicating. Stale branches to ignore: `#8` (adversarial crypto, superseded), old `#15`/`#16`/`#12` (landed via `#26`/`#28`).

Do not open a fifth parallel branch for the same theme.
