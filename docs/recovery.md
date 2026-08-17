# 4AllPass Recovery Key (v1)

**Status:** Authoritative for the Emergency Kit  
**Companion to:** `crypto-protocol.md` §6  
**Date:** 2026-08-17

The Recovery Key is a **32-byte CSPRNG value**. It is the only offline path back into a vault if the Master Password is forgotten and every device envelope is gone.

It is **not** an AES key.

---

## 1. Strength

| Property | v1 rule |
|---|---|
| Entropy | 256 bits, `crypto.getRandomValues` |
| Encoding | Checksummed hex (`4ap1k.…`) — not BIP39 |
| Wrapping | HKDF-SHA-256 → RWK → Recovery Envelope |
| Storage | Offline Emergency Kit only (print + QR). Never on the server in recoverable form. |

256 bits is enough. The remaining risk is **loss** or **theft of the kit**, not brute force of the key itself.

BIP39 is an optional future encoding of the **same 32 bytes**. v1 does not take a word-list dependency.

---

## 2. Emergency Kit string

```
4ap1k.<64 lowercase hex key>.<8 hex checksum>
```

```
checksum = SHA-256("4allpass-recovery-checksum-v1" || key)[0:4]
```

`parseRecoveryKey` accepts any case and ignores whitespace and dashes, then verifies the checksum. A single-character typo fails closed.

Known-answer: **TV-RECOVERY-ENCODE** in [`test-vectors/recovery-v1.json`](test-vectors/recovery-v1.json).

The printable kit also shows:

- Vault ID
- The recovery string (and a QR of that same string)
- A warning that this is the only recovery path
- An instruction to store it offline

---

## 3. Wrapping

```
RWK = HKDF-SHA-256(
  IKM  = recovery_key,
  salt = SHA-256(encodeAad(["4allpass-recovery-salt-v1", vault_id])),
  info = encodeAad(["4allpass-recovery-wrap-v1", vault_id, crypto_version_u32be]),
  L    = 32
)
```

Then `wrapVaultKey({ type: "recovery", wrappingKey: RWK })`.

A raw recovery key **must not** unwrap the envelope (`TV-RECOVERY-WRAP` / the adversarial HKDF test).

On recovery:

1. Parse the kit string.
2. Derive RWK for this `vault_id`.
3. Unwrap the Recovery Envelope → VK.
4. Mint a new Master Envelope (and optional Device Envelopes).
5. Commit a new snapshot. Do **not** rotate VK unless a device may already know it.

---

## 4. What this is not

- Not a server-side reset.
- Not derived from the account password or OAuth.
- Not a substitute for hard rotation after a compromised device (the Recovery Envelope still wraps the **current** VK).
