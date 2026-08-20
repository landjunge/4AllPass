# Selective sharing (v1)

**Status:** What the PWA actually does.  
**Companion:** `crypto-protocol.md`, `security-boundary.md`, `post-quantum-roadmap.md`  
**Date:** 2026-08-20

v1 is **symmetric**. There is no X25519/ML-KEM, so this client cannot wrap a Vault Key (or a per-item key) to someone else’s Device Key. That would be public-key wrapping and is later.

Device envelopes still mean: **which of your devices can unwrap this vault.** Enable / revoke that on the Devices panel. That is not “send this login to another person.”

## What “Share” does

On a saved entry the PWA builds a **portable snapshot**:

1. New random vault id (`share_…`) and a new random Vault Key.
2. One **recovery** envelope wrapping that key (same recovery-key encoding as the Emergency Kit).
3. Only the chosen entries, re-encrypted under that key, with a sealed manifest.
4. A JSON file `{ "kind": "4allpass-share-v1", "snapshot": … }`.

The file is downloaded. The share key is shown once. **Neither is uploaded.** The server still only stores the sender’s own opaque snapshot.

Import: choose the file, enter the share key, confirm. Entries are decrypted on this device, given new ids, then committed under the **recipient vault’s** Vault Key.

## Honest limits

- Anyone who has **both** the file and the share key can read those logins. You cannot remotely un-share a copy they already have (same class of fact as a printed recovery kit).
- This is not live access to your vault and not a server ACL.
- Wrapping to a foreign Device Key stays later (`docs/post-quantum-roadmap.md`).

## Tests

`frontend/src/lib/share.test.ts`: round-trip of one entry, wrong key, tampered ciphertext.
