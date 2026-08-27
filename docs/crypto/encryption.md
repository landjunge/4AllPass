## 8. Entry Encryption

### EncryptedEntry
```ts
interface EncryptedEntry {
  id: string;                 // stable entry identifier
  schemaVersion: number;      // plaintext JSON schema; stored, never guessed
  cryptoVersion: number;      // crypto protocol version used to seal this entry
  vaultKeyVersion: number;    // VK generation that sealed this entry
  nonce: Uint8Array;          // 12 bytes
  ciphertext: Uint8Array;     // raw GCM ciphertext (no tag)
  tag: Uint8Array;            // 16-byte auth tag
}
```

`decryptEntry(entry, { vaultKey, vaultId, entryId, vaultKeyVersion })` reads
`schemaVersion`, `cryptoVersion` and `vaultKeyVersion` **from the entry** and
compares the identity fields against what the caller asked for. That is what keeps
a v2 payload decryptable after a schema bump *and* prevents a record from being
served in the slot of a different entry.

### Rules
- Public library API must **not** accept a caller-supplied nonce.
- Nonce is always generated inside the library (`crypto.getRandomValues` or equivalent CSPRNG).
- A test-only hook may accept a nonce solely to reproduce [docs/test-vectors.md](../test-vectors.md).
- Mandatory AAD for every entry encryption, using the encoder in §3.1:

  ```
  "4allpass-entry-v1" || vault_id || entry_id || schema_version_u32be || crypto_version_u32be || vault_key_version_u32be
  ```

  All three version integers in the AAD are the values stored on that same `EncryptedEntry`.

- `entry_id` in the AAD is the entry's own id, so the caller **must** pass the id it
  requested: the AAD proves the record is internally consistent, not that it is the
  record that was asked for.
- `revision` is deliberately **not** part of the entry AAD. It changes on every
  write, so binding it per entry would require re-sealing the whole vault for each
  edit. Freshness of the entry *set* is covered by the manifest (§8.1).
- Plaintext is only ever present on the client after successful unlock.

Worked hex: **TV-ENTRY-01**. Substitution rejections: **TV-TAMPER-CROSS-VAULT**,
**TV-TAMPER-CROSS-ENTRY**, **TV-TAMPER-VAULT-KEY-VERSION**.

---
