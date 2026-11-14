## 9. Serialization, Versioning & Future Migration

- Every KeyEnvelope carries `version: 1` (crypto protocol) and a `vaultKeyVersion`.
- Every EncryptedEntry carries `cryptoVersion: 1`, a `schemaVersion` of its plaintext, and a `vaultKeyVersion`.
- Every Device-Key Envelope carries `version: 1` and a `deviceKeyVersion`.
- The vault snapshot records `crypto_protocol_version`, `revision`, and `vault_key_version` in an authenticated manifest (§8.1) — see [vault-revision.md](../vault-revision.md).
- Byte fields are `Uint8Array`. A deserializer that produces arrays of numbers (plain `JSON.parse`) must be rejected as malformed input rather than reaching AEAD, where it would look like tampering.
- Future protocol changes (new KDF, new AAD schema, new algorithms) will increment the crypto version and provide a migration path.
- Post-quantum: v1 has no public-key wrapping. Hybrid KEM is a later `cryptoVersion` if sharing or remote enrol needs it — [`post-quantum-roadmap.md`](../post-quantum-roadmap.md), not this version.
- Item share in v1 is a portable snapshot with a recovery envelope, not a new envelope type and not a server ACL — [`sharing.md`](../sharing.md).
- KDF parameters live inside the Master Envelope so that the client can always re-derive the correct Master Key even after a profile upgrade.

---

### Explicit P04 snapshot/manifest candidate

Snapshot/manifest v2 is an opt-in library candidate, distinct from entry and
envelope encryption format 1. Omitted caller expectations retain v1; no header
can negotiate an upgrade and an expected-v2 read never falls back to v1.
See [the exact API/domain boundary](snapshot-manifest-v2-candidate.md). Existing
v1 vectors remain unchanged. Revision/pin APIs have an explicit v2 candidate,
with v1 defaults and no protocol migration. Session integration and full
signed-write/client/server acceptance remain open.
