# 4AllPass Recovery Key & Emergency Kit (v1)

**Status:** Authoritative for the recovery path
**Companion to:** `crypto-protocol.md` §6
**Date:** 2026-08-17

The Recovery Key is the only way back into a vault when the Master Password is lost
and no enrolled device remains. There is no server-side reset, no e-mail recovery
and no OAuth path. That makes two properties non-negotiable: it must carry full
256-bit entropy, and a human must be able to copy it off a printed sheet without
silently corrupting it.

---

## 1. The key

| Property | Value |
|---|---|
| Length | 32 bytes (256 bit) |
| Source | CSPRNG (`crypto.getRandomValues`) only |
| Derivation from anything user-chosen | **forbidden** |
| Storage on the server | never, in any form |
| Reuse across vaults | never |

An all-zero key is rejected by the library: it is the signature of an uninitialized
buffer, not of a generated key.

---

## 2. Emergency-Kit representation

```
payload   = recovery_key (32 bytes) || checksum (2 bytes)
checksum  = SHA-256( frame([ "4allpass-recovery-checksum-v1", recovery_key ]) )[0..2]
encoded   = Crockford-Base32(payload)                     // 55 characters
formatted = groups of 5 characters joined with "-"         // 11 groups
```

Crockford Base32 is used deliberately:

- The alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ` omits `I`, `L`, `O` and `U`, so
  the classic transcription confusions cannot produce a *different valid* key.
- `O` → `0` and `I`/`L` → `1` are accepted on input as documented substitutions.
- Case is irrelevant; `-`, space, `_` and `.` are ignored.

Parsing rules (all enforced by `parseRecoveryKey`):

| Rule | Failure |
|---|---|
| Every character is in the alphabet (after substitutions) | `ProtocolError` |
| Decodes to exactly 34 bytes | `ProtocolError` |
| Padding bits of the final character are zero (canonical form) | `ProtocolError` |
| Checksum matches | `IntegrityError` |

The checksum exists so that a mistyped character is reported as *a typo*, not as
"wrong recovery key". It adds no security: the entropy is the 256-bit key.

Known-answer tests: **TV-RK-FORMAT**, **TV-RK-CHECKSUM**, **TV-RK-NONCANONICAL** in
[`test-vectors/recovery-v1.json`](test-vectors/recovery-v1.json).

---

## 3. Recovery Wrapping Key

The printed key is never used directly as an AES key:

```
RWK = HKDF-SHA-256(
  IKM  = recovery_key,                                       // 32 bytes
  salt = SHA-256(encodeAad(["4allpass-rwk-salt-v1", vault_id])),
  info = encodeAad(["4allpass-recovery-wrap-v1", vault_id, crypto_version_u32be]),
  L    = 32
)
```

```
Recovery Key (printed)
        │
        ▼
   HKDF-SHA-256          ← vault-bound salt + info
        │
        ▼
      RWK (32 bytes)
        │
        ▼
  unwrap Recovery Envelope (type = "recovery")
        │
        ▼
       VK
```

Why the extra step, when the recovery key is already 32 uniform bytes:

- **Vault binding.** The same kit cannot open a Recovery Envelope of a different
  vault, even if an attacker relabels the envelope.
- **Domain separation.** The recovery derivation has its own label space, so the
  same 32 bytes used elsewhere (for example as a PRF result) never produce the same
  key.
- **Room to move.** A future kit format (Shamir shares, a second recovery factor)
  changes the derivation, not the envelope format.

The Recovery Envelope itself is an ordinary `KeyEnvelope` with `type = "recovery"`,
so it carries `vaultKeyVersion` and is covered by the snapshot manifest like every
other envelope.

Known-answer tests: **TV-RWK-01**, **TV-RWK-WRONG-VAULT**, **TV-ENV-RECOVERY-RWK**.

---

## 4. Lifecycle

### Creation (at vault creation)

1. Generate VK, then the Recovery Key.
2. Derive RWK, wrap VK → Recovery Envelope, include it in the first snapshot.
3. Present the Emergency Kit **once**, in the formatted representation, together with
   the `vault_id`.
4. Zeroize the Recovery Key in memory as soon as the kit has been displayed or printed.

The Emergency Kit contains: `vault_id`, the formatted Recovery Key, the creation
date, and a plain statement that this is the only recovery path and that 4AllPass
cannot restore access without it.

### Use

1. User enters the key; the client normalizes and checksums it before doing any work.
2. Derive RWK, unwrap the Recovery Envelope against `expectType: "recovery"` and the
   snapshot's `vaultKeyVersion`.
3. The vault is unlocked, but the recovery secret is now "used": the client must
   immediately offer to set a new Master Password (new Master Envelope) and to
   re-enrol devices.

### Rotation

Issuing a new Recovery Key is a normal snapshot write: generate a new key, derive a
new RWK, replace the Recovery Envelope, commit revision `N+1`. Because the old
envelope is absent from the new snapshot, the old kit stops working as soon as the
new revision is pinned — subject to the same "a malicious server can withhold the
new snapshot" caveat as any other revocation.

If the Recovery Key may have been exposed, treat it as a compromised secret that
knows VK: perform a **hard rotation** (`vault-revision.md` §5), not just an envelope
replacement.

---

## 5. What this does not solve

- A stolen Emergency Kit is full vault access. Offline storage is the only control.
- A printed kit cannot be revoked retroactively; only rotation plus a pinned newer
  revision removes its usefulness.
- The checksum protects against typos, not against a maliciously modified printout.
