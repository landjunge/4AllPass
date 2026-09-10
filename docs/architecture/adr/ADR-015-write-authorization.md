# ADR-015 — Write authorization: proving Vault Key possession to the server

**Status:** accepted as a staged plan — steps 1–2 build now, step 3 does not  
**Date:** 2026-09-09

## Context

`get_owned_vault` is the only thing standing between a request and a vault
write. It checks a valid bearer session and `Vault.owner_user_id`. Nothing in
the write path asks whether the caller can open the vault.

`POST /vaults/{id}/snapshots` requires `sealedManifest` to be *present* from
revision ≥ 1, but the server stores it opaque and never opens it
(`services/snapshots.py`). Only the client verifies it, on open. So a caller
holding a stolen account token and **no** Master Password can commit a
syntactically valid snapshot whose manifest is garbage, and CAS-flip
`active_snapshot_id` to it. They read nothing. They destroy access.

Six more state-changing routes have the same authorization and no key proof:
device POST (which also clears `revoked_at`), device DELETE, credentials POST,
the Device-Key-Envelope PUT, and both WebAuthn challenge routes. Device DELETE
and the envelope PUT additionally have **no write rate limit** at all.

`docs/threat-model.md` names actor #7 "Remote Attacker with Account Access" and
then never gives it a consequences analysis: §3 and §5 analyse the malicious
*server* only. The security goal that is stated — "account compromise alone
never grants vault decryption" — is about confidentiality and holds. Integrity
and availability under a stolen token were **overlooked, not accepted**.

Two ADRs already sit in this space and both say do not build:

- **ADR-008 (agent identity)** deliberately keeps verification on the unlocked
  client: "Broker verifies on the unlocked client, not as FastAPI."
- **ADR-012 (proof and signature layer)** is research-only, and frames
  signatures as *attribution* — "the server stores an opaque blob if needed",
  which is precisely today's design.

Neither was wrong. Both answer a different question: *who did this, provably,
after the fact*. This ADR asks: *may the server accept this write at all*.
Attribution can stay client-side. Write authorization cannot — the server is
the only party that can refuse a write, so it is the only party that can
enforce it.

`docs/post-quantum-roadmap.md` also warns: "do not invent a parallel signature
scheme in `packages/crypto`." That warning is about replacing WebAuthn's ES256.
It still binds the shape of any answer here: reuse, do not invent.

### What we already have

- `packages/crypto/src/requester.ts` — Ed25519 **verification**, adversarially
  tested (`test/adversarial-requester.test.ts`), exported, and wired to nothing.
  No keygen, no signing side, by design.
- The backend already verifies signatures for WebAuthn COSE
  (`core/webauthn_cose.py`) via `cryptography`, so server-side Ed25519 needs no
  new dependency — only an explicit pin, since `cryptography` is currently
  transitive through `webauthn`.
- `sealedManifestDigest(sealed)` is already a stable 32-byte handle over a
  commit's authenticated bytes — the natural thing to sign.
- HKDF-SHA256 from a key is the established derivation shape here (DWK, RWK).
- `cryptoProtocolVersion` plus a nullable column is the established migration
  gate (ADR-005; `alembic/…_sealed_manifest.py` is the precedent).
- The write surface is far narrower than it looks: `frontend/src/lib/api.ts` is
  the **only** issuer of vault writes. Desktop proxies the same TypeScript
  through `sidecar_http`; the extension only reads. One signing implementation,
  not five.

### What we do not have

WebCrypto Ed25519 is Chrome 137+ / Firefox 129+, and cannot `importKey("raw", …)`
a private seed — an HKDF(VK)→seed design needs a DER/PKCS8 wrapper. Any hard
requirement locks out older browsers, and "the vault refuses to save" is a worse
failure than the attack it prevents.

## Decision

Staged. Steps 1 and 2 land now; step 3 is designed here but deliberately not
built yet.

**1. Rate-limit the unlimited destructive routes.** Device DELETE and the
Device-Key-Envelope PUT get the same `enforce_write_rate_limit` treatment the
snapshot and device routes already have. This does not fix the gap; it removes
the free hand.

**2. Recover from a poisoned head at unlock.** Today an unopenable head is
terminal in practice: `verifySnapshotManifest` fails, the vault does not open,
and — as built in #203 — **the revision history lives inside the unlocked
vault, so it is unreachable exactly when it is needed.** ADR-015 fixes that
asymmetry: when the active revision fails integrity, unlock falls back to
offering the newest revision that *does* verify under the derived Vault Key,
and restoring it is the ordinary forward commit. This converts the attack from
"vault destroyed" to "vault has an annoying bad revision on top", using the
read routes that already exist. It is the highest value per line of code here.

**3. Signed writes — designed, not built.** When built, it is:

- An Ed25519 keypair per vault-key generation, seed = `HKDF-SHA256(VK, …)`
  with a new domain-separation label, so anyone who can open the vault
  reproduces it and nothing extra needs storing or recovering.
- The **public** key is registered server-side on a nullable vault column and
  rotates with `vaultKeyVersion`.
- Each state-changing request carries a detached signature over canonical bytes
  binding vaultId, route, revision, `vaultKeyVersion`, and
  `sealedManifestDigest` where one exists. Reuse `requesterRequestBytes`'
  canonicalization; add the signing half to `requester.ts` rather than a second
  module.
- Enforcement keyed off `cryptoProtocolVersion`: existing vaults keep working,
  version 2 vaults require the signature, per ADR-005.

## Why

The gap is real and the fix is known. It is still not tonight's work:

- It changes seven routes and the wire protocol.
- It is gated on browser Ed25519 support we do not control, and the failure mode
  of getting that wrong is worse than the attack.
- Two ADRs currently say "do not build" in this area. Reversing them is the
  maintainer's call, not a side effect of a bug fix.

Step 2 is the honest interim answer because it attacks *impact* rather than
*access*: it does not stop a token holder from writing garbage, it stops that
garbage from being permanent. That is most of the harm, for a fraction of the
change, with no protocol break and no browser dependency.

## Alternatives

- **Symmetric MAC under a VK-derived key.** Cheaper, and `@noble/hashes` already
  ships HMAC. Rejected: the server must hold the verification key, so it would
  hold VK-derived material. That trades the whole zero-knowledge claim for
  convenience.
- **Server verifies the sealed manifest itself.** Impossible by construction —
  it is sealed under VK, which the server must never have.
- **Bind writes to a WebAuthn assertion.** Hardware-backed and appealing, but
  ties every write to a per-device ceremony, breaks the desktop path where PRF
  is unavailable (`security-boundary.md` measures `prf: null` in the WKWebView),
  and proves device possession, not vault-key possession.
- **Do nothing beyond documenting it.** Rejected: #201 is not hypothetical, and
  step 2 is cheap.

## Consequences

Until step 3 ships, the honest claim stays: **a stolen account session cannot
read a vault, and cannot permanently destroy one, but can still force a
recovery step.** `security-boundary.md` §6 must keep saying so. Do not describe
snapshot commits as authenticated by the Vault Key.

`threat-model.md` gains the missing actor-#7 consequences analysis, including
the unauthorized soft revoke it already concedes elsewhere.

If step 3 ships later, ADR-008 stays intact — agent identity verification
remains client-side; this is vault write admission, a different question — and
ADR-012 should be updated to point here rather than left to imply the server
never checks anything.

## Future impact

A registered per-vault public key is also the natural anchor for the
public-key wrapping in `post-quantum-roadmap.md` §3 and for ADR-012's later
attribution work. Choosing the derivation label and the canonical byte format
carefully now costs nothing and keeps both doors open. It is deliberately *not*
an identity the server can name — it is a key generation, not a principal.
