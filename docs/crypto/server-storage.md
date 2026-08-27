## 11. What the Server Is Allowed to Store

The server may store:
- Account authentication data (email, account password hash, OAuth identifiers)
- Vault metadata (`vault_id`, creation time, `crypto_protocol_version`, `revision`, `vault_key_version`) — note that this metadata is **advisory**: the client only believes it once the sealed manifest verifies (§8.1)
- Immutable snapshots (envelopes + entries + sealed manifest) and the `active_revision` pointer
- Device metadata (`deviceId`, user-agent summary, last seen, WebAuthn credential IDs)
- Salts and Argon2 parameters (they live inside the Master Envelope)

The server must **never** store:
- Master Password
- Vault Key in plaintext
- Any key that can decrypt the vault without user secrets
- Plaintext entry data

---
