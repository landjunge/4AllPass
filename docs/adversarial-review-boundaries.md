# Adversarial review — component boundaries (v1)

**Scope:** the six attack paths on current `main` (extension fill, agent/broker,
snapshot rollback, hard-revoke race, WebAuthn credential substitution, localhost
`:8788`). Not `packages/crypto` internals — those are
[`adversarial-review.md`](adversarial-review.md).
**Date:** 2026-08-26 (pass 2: agent identity, TTL, DOM fill, recovery/PRF/revoke)
**Companions:** `security-boundary.md`, `autofill-v1.md`, `local-access-broker.md`,
`vault-revision.md`, `webauthn-prf.md`, `threat-model.md`

Method: attacker with a **malicious website**, a **malicious local process**,
and a **malicious snapshot server**. Reproduce or argue a concrete attack, or
say no finding.

This is not a complete external audit. It is the first pass over the boundaries
where AES-GCM will not save you.

---

## Verdict

**ship-with-nits** for the current product (autofill + local broker + sealed
snapshots). No Critical/High vault-plaintext exploit found after the fill-path
fixes in this pass.

The crypto core still looks like the earlier review said: PRF → HKDF → DWK →
Device Key → Vault Key, caller expectations on unwrap, AAD that binds identity
and revision. The remaining risk is at **component edges**, not at AES-GCM.

Do not read this as “no High will ever exist.” Shadow DOM, cross-origin iframes,
and agent *identity* are still out of V1.

---

## Claims vs reality

| Claim | Code |
|---|---|
| PRF is not used as an AES key | `deriveDeviceWrappingKey` + `unwrapVaultKeyWithPrfOutput` |
| Envelope self-consistency ≠ identity | `unwrapDeviceKey` requires caller `vaultId` / `deviceId` / `credentialId` / `deviceKeyVersion` |
| Fill origin is the trust boundary | `entriesForPage` + `expectedOrigin` in the content script + `sameFillOrigin` before send |
| Browser Origin cannot take a grant | `broker.py` `browser_grant_origin` → 403, including `Origin: null` |
| FastAPI never mints access tokens | `/v1/access/request` is a pairing queue; secret comes from the unlocked UI `decide` |
| Hard revoke cannot decrease VK | `commit_snapshot`: `vaultKeyVersion must not decrease`; unique `(vault_id, revision)` |
| Client refuses snapshot rollback | `assertFreshSnapshot` / `RollbackError`; extension pin in `chrome.storage.local` |
| Application identity is cryptographic | **Over-claim if said.** Identity is the string `n8n` + pairing token. Documented. |

---

## Findings

### F-B1 — Fill TOCTOU (match URL, then navigate, then fill) · **medium** · new · **fixed**

**Attack.** `fillActive` matched `tab.url`, then `probe-form`, TOTP, then
`tabs.sendMessage` with username + password + OTP. `tab.url` was not re-read.
The content script filled whatever document currently owned the tab. A page that
navigated from `https://github.com` to `https://evil.example` in that window
could receive the GitHub password.

**Impact.** Credential leakage to a different origin. Classic password-manager
class; not vault unwrap.

**Fix.** Background re-checks `tab.url` after probe (`sameFillOrigin`). Fill
payload carries `expectedOrigin`. Content script refuses unless
`location.origin` matches. Privileged `runtime` messages from a content-script
sender (`sender.tab`) are rejected.

**Test that fails if reverted.** `sameFillOrigin refuses a navigation between match and fill`;
content script `expectedOrigin` branch; `content-script senders are not privileged`.

### F-B2 — HTTPS entry filled into `http://` same host · **medium** · new · **fixed**

**Attack.** `hostMatch` compared hostnames only. `http://github.com/login`
matched a stored `https://github.com` entry. On a network without HSTS that is
a plaintext downgrade.

**Fix.** `pageSchemeAllowsFill`: HTTPS pages always; HTTP only on loopback, or
when the stored URL is itself HTTP (LAN router and `127.0.0.1` test-login).

**Test.** `entriesForPage does not fill an HTTPS GitHub entry into HTTP github.com`;
`entriesForPage still fills loopback HTTP (local test-login)`.

### F-B3 — Suffix match on a shared parent host · **medium** · new · **fixed**

**Attack.** Stored `https://github.io` suffix-matched `evil.github.io` because
`pageHost.endsWith(".github.io")` and the host has two labels. Same class as
`herokuapp.com` / `vercel.app`. Not a full Public Suffix List.

**Fix.** Deny-list of shared-parent hosts. Exact match still works. A stored
tenant (`ada.github.io`) still matches that tenant, not a sibling.

**Test.** `entriesForPage does not suffix-match a shared parent host (github.io)`.

**Residual.** This is not the PSL. An unlisted multi-tenant suffix can still
suffix-match. Subdomain takeover of `login.example.com` when the user stored
`example.com` is accepted (same as other managers that suffix-match).

### F-B4 — Agent identity is a string · **medium** · accepted (documented)

**Attack.** Pairing token + `application: "n8n"` is enough to put a request on
the Allow queue. A local process that stole `broker.token` (mode 0600 in the
data dir, also `GET /api/v1/local/broker` after local storage auth) can look
like n8n. If the human Allows, that process gets the time-boxed grant.

`POST /v1/broker/decide` with the pairing token and **no** Origin is accepted
(the UI often omits Origin). The attacker still cannot invent the GitHub
secret: `decide` body is whatever the unlocked UI posted. They can deny (DoS)
or phish the human.

**Not a vault unwrap.** FastAPI still never decrypts. Unknown apps are DENY
(`evaluatePolicy`). Browser Origin on `/v1/access/request` is 403.

**Fix later:** agent identity beyond a string (see
`docs/architecture/adr/ADR-008-agent-identity.md`). Do not implement that in
this pass.

### F-B5 — In-memory VK after hard revoke · **low** · accepted

Device B with VK1 cached keeps plaintext until it pulls (`vaultKeyVersion`
change → extension `lockVault`) or the process locks. `DELETE /devices` is
still `metadata_only`. Documented in `security-boundary.md` §4.

Server race is held: `SELECT … FOR UPDATE` / SQLite `BEGIN IMMEDIATE`, unique
`(vault_id, revision)`, `vaultKeyVersion` must not decrease. Test:
`test_concurrent_same_vk_commit_and_hard_revoke_one_wins`.

### F-B6 — Noble crypto ranges (`^`) · **low** · nit

`@noble/ciphers ^1.3.0` and `@noble/hashes ^2.3.0`. Lockfile exists. Exact pins
+ hash + reproducible build are supply-chain hardening, not a working exploit.

### F-B7 — Agent TTL is a grant clock, not a provider-token clock · **medium** · accepted

`issueGrant` copies `entry.password` into `access_token` and sets `expiresAt`
from `ttlSeconds`. After that clock, `approvedResponse` / `readGrant` refuse
*later 4AllPass handoffs*. The GitHub PAT (or other secret) already sitting in
n8n is not rotated. Docs that say “time-boxed credential” without this split
are an over-claim.

**Test.** `TTL expires later 4AllPass handoffs; the vault secret is not rotated`.

### F-B8 — Page DOM is the final autofill trust boundary · **accepted**

Not a bug. After fill, page JS can read `input.value`. Documented in
`security-boundary.md` and `autofill-v1.md` invariant 8.

### F-B9 — Suffix match on ordinary registrable domains · **accepted**

`github.com` → `foo.github.com` is intentional. Shared-parent hosts are denied
(F-B3). Per-provider `matchPolicy: exact | subdomains | provider` is future,
not V1.

---

## Pass 2 — Recovery, hard-revoke, rollback, WebAuthn-PRF

No new Critical/High vault-break. Existing adversarial tests still hold:

| Area | What was checked | Result |
|---|---|---|
| Recovery | Printed key is never AES; RWK = HKDF bound to vault; all-zero rejected; checksum is transcription not security; recovery vs device HKDF domains differ | held (`adversarial-kdf-prf`, `recovery.ts`) |
| Hard revoke | Master (+ recovery if present) must unwrap the **same** VK before rotate; `hardRevokeDevice` CAS then metadata DELETE; recovery envelope that unwraps a different VK is refused; server will not decrease `vaultKeyVersion` | held (`vault-session.hard-revoke.test.ts`, backend race test) |
| Rollback | Pin from verified manifest; older authentic snapshot is `RollbackError`; mixed entries fail digest | held (`adversarial-freshness`) |
| PRF | 32 bytes, not all-zero, not used as AES key, `eval.first` bound to RP+vault, DWK bound to rp/vault/device/credential, assertion `rawId` must match | held (`adversarial-kdf-prf`, `assertPrfOutput`) |
| Agent identity | `TRUSTED_APPLICATIONS` is a string list. Spoofed `n8n` is policy-allow eligible. **Not built** (P2/P3, ADR-008) | documented; test pins the limitation |

---

## Attack paths (what we actually tried)

### 1 — Credential leakage (evil site → extension → fill)

| Probe | Result |
|---|---|
| `evilgithub.com` / `github.com.evil.test` / `notgithub.com` | no match (`match.test.ts`) |
| `github.com@evil.com` userinfo | hostname is `evil.com` |
| IDN `gіthub.com` | punycode, not `github.com` |
| TLD-only stored host `https://com` | no suffix match |
| `providerId: github` on `evilgithub.com` | cannot override conflicting URL |
| Trailing DNS dot | stripped |
| `http://github.com` vs stored HTTPS | **was a fill; now denied** |
| `evil.github.io` vs stored `github.io` | **was a fill; now denied** |
| iframe: `all_frames` default false; match uses `tab.url` (top) | no fill into a foreign iframe |
| `github.com` page, evil iframe | fill targets the top document, not the iframe |
| Navigation between match and fill | **was open; now `origin-mismatch`** (`fillTargetStillHolds` before executeScript) |
| `www.github.com` / `foo.github.com` | match (www stripped; subdomain is intentional) |
| `github.com%2eevil.com` | hostname `github.com.evil.com` → no match |
| Content script `fill-tab` to background | rejected (`sender.tab`) |
| `externally_connectable` | absent |

Website never receives the vault, only field values. FastAPI never sees the fill.

### 2 — Agent escape (malicious agent → broker → credential)

```
token creation (0600 file / env)
  → pairing (GET /api/v1/local/broker after local auth)
  → POST /v1/access/request (no browser Origin)
  → UI poll → human Allow/Deny
  → decide (UI supplies grant)
  → agent
```

Held: wrong token 401, browser Origin 403, vault locked without listener,
unknown app DENY, `compare_digest`, FastAPI has no `/v1/access` mint.
Not held: spoofed `application: "n8n"` after token theft (F-B4).

### 3 — Vault rollback (valid old snapshot → client unlock)

`assertFreshSnapshot` throws `RollbackError` on lower revision. Manifest AAD
binds `vault + crypto version + revision + vault key version`. Pin is written
from a **verified** manifest (`revisionFromManifest`). Extension
`openUnlockedSnapshot` test: `refuses a replayed older snapshot after the pin`.
While unlocked, a lower revision on poll is caught and the last good entries
are kept. Same-revision number with different bytes is not adopted on poll
(revision integer short-circuit) and is equivocation on next open if a digest
was pinned.

First-seen (no pin) accepts whatever authentic snapshot is offered. That is
not rollback.

### 4 — Hard-revoke race (A and B, VK1 → VK2)

Serialized writers. Exactly one of same-VK vs VK++ wins; the other is 409.
Loser retry cannot decrease `vaultKeyVersion`. Revoked device envelopes cannot
be re-attached. Residual: RAM on the other device (F-B5).

### 5 — WebAuthn credential substitution

`assertPrfOutput` requires UV, the authenticator `rawId` to equal the requested
`credentialId`, and PRF length 32. DWK is derived from **caller** `rpId` /
`vaultId` / `deviceId` / `credentialId`, not from envelope fields.
`unwrapDeviceKey` compares the same expectations. A swapped envelope fails
GCM / `IntegrityError`.

Tauri WebView PRF is still **unproven** (`security-boundary.md` §6). That is
not a substitution bug; it is “this path is not the unlock story in the app.”

### 6 — Localhost `:8788`

Bind is `127.0.0.1` only (`prepare_local_runtime` rejects other hosts). CORS
allowlist is that origin. Grant path with `Origin: http(s)://…` or `null` is
403. `@4allpass/access` refuses non-loopback URLs. DNS rebinding from a web
page hits the Origin 403. `::1` is not the bind address.

A local process **on the box** with the pairing token is F-B4, not a remote
localhost bypass.

---

## Invariants

- [x] Key path (PRF → HKDF → DWK, not PRF-as-AES) still held
- [x] Caller expectations on unwrap still held
- [x] Freshness pin / sealed manifest still held
- [x] Honest revoke names still held
- [x] Fill origin as trust boundary — **was incomplete (F-B1–B3), now held for V1**
- [x] FastAPI never decrypts / never mints grants still held
- [ ] Agent identity is not cryptographic (known; Team/ADR-008 not in this pass)

---

## Tests I would add (done in this pass)

- HTTP downgrade of an HTTPS vault URL
- Shared-parent suffix (`github.io`)
- Trailing DNS dot
- Loopback HTTP still fills
- `sameFillOrigin` navigation
- Privileged sender vs `sender.tab`

Already on `main` before this pass: `match.test.ts` lookalikes / userinfo /
punycode / TLD; `test_access_broker.py` Origin 403 / wrong token / vault_locked;
`test_concurrent_same_vk_commit_and_hard_revoke_one_wins`;
`adversarial-identity` credential swap; `adversarial-freshness` rollback;
`assertPrfOutput` wrong `rawId`.

## Improve next (only if in scope)

- Full Public Suffix List instead of a shared-parent denylist
- Shadow DOM / cross-origin iframe fill (explicitly not V1)
- Agent identity beyond a string (do **not** start here unless asked)
- Exact Noble pins + hash in the reproducible-build story
- Zeroize is still JS; copies from `tabs.sendMessage` serialization remain
