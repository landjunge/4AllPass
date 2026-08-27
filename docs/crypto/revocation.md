## 7. Device Lifecycle & Revocation

### Adding a new device
1. Unlock the vault (Master Password or Recovery Key).
2. (Optional) Register WebAuthn credential and create Device Key Material.
3. Create new Device Envelope.
4. Upload Device Envelope to server.

### Soft Revocation (device not believed compromised)
- Server simply deletes / disables the Device Envelope.
- The device can no longer obtain the Vault Key via sync.

### Hard Revocation (device may be compromised)
Because a compromised device already knows the current Vault Key, soft revocation is insufficient.

**Required procedure – Vault Key Rotation:** see **[docs/vault-revision.md](../vault-revision.md)**.

Summary: produce a complete new snapshot at `revision N+1` with `vault_key_version + 1`, re-encrypt every entry, mint a full new envelope set, then CAS `active_revision`. Never mix VK₁ entries with VK₂ envelopes.

Implementations **must** support Vault Key Rotation and must refuse rolled-back revisions (`evaluateRevision`).

---
