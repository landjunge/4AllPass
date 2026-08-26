# Adversarial Code Review — External pass 01 (`packages/crypto` manifest path, `src-tauri` browser import)

**Scope:** `packages/crypto/src/manifest.ts` and `envelope.ts` (KDF enforcement
consistency), `packages/crypto/src/constants.ts` / `docs/crypto-protocol.md`
(nonce budget), and `src-tauri/src/browser_passwords.rs` +
`src-tauri/src/firefox_logins.rs` (native browser credential import) — the
last of these had received no adversarial review pass before this one.

**Date:** 2026-08-26
**Reviewer:** Claude (Anthropic), acting as an external reviewer at the
maintainer's request — not a member of the project team, no prior exposure to
unpublished design rationale beyond what is in this repository.
**Companions:** `adversarial-review.md` (internal pass, `packages/crypto`
core), `crypto-protocol.md`, `audit-scope.md`, `threat-model.md`

**Status after intake (2026-08-26):** F-24, F-26, F-27 **fixed** in tree (manifest
production KDF, owner-only temp + shred + `zeroize`, redacted `Debug`). F-25
**accepted residual** — no persistent per-VK seal counter yet; policy remains
`SEALS_PER_KEY_MAX` in `crypto-protocol.md` §3.3.

**Method:** read the source directly against an attacker/misuse model, not
against the documentation's claims about itself. Two of the four findings
below (F-24, F-25) were traced end-to-end through every call site in
`frontend/src` and `backend/app` to determine actual exploitability, not just
theoretical inconsistency — the trace result is recorded in each finding.
None of these were reproduced as working exploits against a running instance;
that is the gap between this pass and a funded external audit, and is exactly
why F-27's recommendation is to fund one.

---

## 1. Findings

### F-24 — KDF production floor is bypassed in the manifest normalization path · **medium** · open

`manifest.ts`, `normalizeEnvelope()`:

```ts
if (type === "master") {
  if (!kdf) throw new ProtocolError("master envelope requires kdf parameters");
  record.kdf = assertKdfBlock(kdf, true);   // allowTestProfile hardcoded true
```

This accepts the weak, test-only `ci` Argon2id profile (32 KiB memory, 3
iterations) as structurally valid when a master envelope is folded into a
snapshot manifest for digesting — instead of enforcing
`assertProductionKdf`'s floor, which `envelope.ts`'s `unwrapVaultKey()`
correctly applies by default (`allowTestProfile` defaults to `false` there).

**Exploitability trace:** `allowTestProfile` is never set anywhere in
`frontend/src` or `backend/app` (checked via full-repo grep). The actual
key-derivation gate in `unwrapVaultKey()` is unaffected and still enforces the
production floor. **Not currently exploitable** — a malicious server can get a
weak-KDF master envelope accepted into a manifest's digest, but the client
will still refuse to actually derive a key from it at unlock time.

**Why it is a finding anyway:** the inconsistency is undocumented — no
comment at the call site explains why manifest normalization deliberately
uses the weaker check while the real unlock path uses the stronger one. That
reads as an oversight, not a decision, to anyone auditing the file in
isolation, and it is exactly the kind of asymmetry a future refactor could
turn into a real bypass (e.g. if a caller ever comes to trust
"survived manifest normalization" as a proxy for "safe to unwrap").

**Recommendation:** either enforce `assertProductionKdf` in
`normalizeEnvelope()` as well, or add an explicit comment at the call site
recording that this is intentional and stating which downstream check is
relied on to catch a weak-KDF envelope before it is ever used to derive a
key.

### F-25 — Nonce budget (2^32 seals) is a documented policy, not an enforced counter · **medium**, severity rises with agent-driven write volume · open

`docs/crypto-protocol.md` §3.3 states the birthday bound for 96-bit random
nonces under one key (~2^32 seals) and says explicitly: *"This is a policy
limit, not an enforced counter: implementations that seal at high volume
(bulk import, automated writers) must track it."*

**Exploitability trace:** grepped `packages/crypto/src`, `frontend/src`, and
`backend/app` for any seal counter, rotation trigger, or threshold warning —
none exists. Nothing in the codebase currently tracks how many AEAD seals
have occurred under the active Vault Key.

For a human typing entries by hand this is not a practical concern. It
becomes one for the Secret Access Layer / broker use case the project is
actively building toward (`docs/secret-access-layer.md`,
`docs/local-access-broker.md`): an automated writer cycling under one Vault
Key over a long deployment lifetime is precisely the "automated writers" case
the documentation itself names as the risk. Nothing in the system would
detect approach to the birthday bound before it happened.

**Recommendation:** implement a persistent per-Vault-Key seal counter with a
forced-rotation trigger well below the theoretical bound (e.g. 2^28–2^30), or
adopt a nonce construction that removes the bound structurally (e.g. a
192-bit nonce scheme) as part of the crypto-agility work already scoped in
the ADRs.

### F-26 — Browser credential import (Tauri/Rust): unencrypted full-store copy on disk, no zeroization · **high** · open

`src-tauri/src/browser_passwords.rs` and `src-tauri/src/firefox_logins.rs`
had no prior adversarial review pass. Two related issues, both present in
both files:

**F-26a — Temp-directory copy of the entire credential store, no permission
hardening, no secure deletion.**

```rust
let tmp = std::env::temp_dir().join(format!("4ap-login-{}-{}", pid, nanos));
fs::create_dir_all(&tmp).map_err(...)?;   // no explicit 0700
fs::copy(&src, tmp.join("Login Data"))...
```

This copies the browser's *entire* login database (Chrome `Login Data`;
Firefox `key4.db` + `logins.json`) — every saved credential for every site,
not only the ones being migrated — into the OS temp directory, with a
predictable name and default (umask-dependent) permissions rather than an
explicit owner-only mode. On multi-user systems, the OS temp directory is
commonly world-readable with the sticky bit set, creating a window in which
another local account could read the copy.

Cleanup is `fs::remove_dir_all(&tmp)`, which unlinks the directory entry but
does not overwrite the underlying bytes. This is a best-effort limitation
common to most filesystems (and especially weak on SSDs with wear-leveling),
but no attempt is made at all here.

**F-26b — No zeroization of decrypted key material or plaintext passwords in
Rust memory.**

The Chrome Safe Storage key extracted from the macOS Keychain, the derived
AES key, the Firefox master key recovered from `key4.db`, and every
decrypted `BrowserLogin.password` are held in plain `Vec<u8>` / `String`.
None of these are wrapped in a zeroizing type; Rust does not zero heap memory
on `Drop` for these types. This is the exact discipline the TypeScript crypto
core (`packages/crypto/src/memory.ts`, used pervasively) applies to Vault Key
material — it is absent here, in the one code path that handles the totality
of a user's *pre-existing* passwords from another store, not just 4AllPass's
own.

**Recommendation:**
- Create the temp directory with explicit owner-only permissions
  (`0700` via `std::os::unix::fs::PermissionsExt`) before copying anything
  into it.
- Best-effort overwrite the temp files before removal, in addition to
  `remove_dir_all`.
- Adopt the `zeroize` crate (or equivalent explicit-wipe pattern) for every
  buffer that holds a derived key or a decrypted password in
  `browser_passwords.rs` and `firefox_logins.rs`.
- Consider reading the source database in place (read-only) where the
  browser's file locking allows it, to avoid the full-store copy entirely.

### F-27 — `BrowserLogin` carries an unredacted `Debug` derive on `password` · **low** · open

```rust
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct BrowserLogin {
    pub password: String,
    ...
}
```

`browser_passwords.rs`'s module doc comment states *"Never logs passwords."*
A full-repo grep for `println!`, `dbg!`, `log::`, `tracing::`, `eprintln!`
under `src-tauri/src` confirms nothing currently logs this struct — the
invariant holds today, but only by convention. A future debugging change
(`dbg!(&login)`) would silently violate it, because the type itself does
nothing to prevent it.

**Recommendation:** hand-write a `Debug` impl that redacts `password` (e.g.
prints `"***"`), so the invariant is structural rather than a comment the
next contributor has to remember.

---

## 2. Assessment

None of these findings undermine the project's core cryptographic claims —
the manifest/AEAD/envelope layer that has already been through an internal
adversarial pass (`adversarial-review.md`) held up under this independent
reading; F-24 and F-25 are gaps in enforcement of already-correct policy,
not breaks in the policy itself.

F-26 is the one finding in this pass with a materially different risk
profile: it is the first review of the native browser-import path, and it
handles the single most sensitive dataset the application ever touches — the
user's complete existing credential store from another product, not just
4AllPass's own vault. The unevenness is itself informative: the most heavily
tested and documented component (`packages/crypto`) is also the one with the
fewest problems: the least-reviewed component is where this pass found the
most. That is an argument for extending `docs/audit-scope.md` to explicitly
include the native Tauri/Rust import paths (`src-tauri/src/browser_*.rs`,
`firefox_logins.rs`) as their own scoped module before those features are
promoted further, rather than assuming the crypto core's review coverage
generalizes to the rest of the codebase.
