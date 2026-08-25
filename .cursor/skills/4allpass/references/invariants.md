# Invariants

Break one of these and the change is blocked, even if tests were added elsewhere.

## Key path

```
Master password ──Argon2id──► Master Key ──unwraps──► Master Envelope ──► Vault Key
Recovery Key ─────────────────────────────unwraps──► Recovery Envelope ─► Vault Key
WebAuthn PRF ──HKDF──► DWK ──unwraps──► Device-Key Envelope ─► Device Key
                                         Device Envelope ─────► Vault Key
```

- Vault Key is always random. Never derive VK from the master password.
- Raw PRF output is never used as a key. HKDF → DWK only.
- Master password and Recovery Key never leave the client. No e-mail reset.
- Compromised recovery **must** increment `vaultKeyVersion` and mint a new
  recovery key (`wrapRecoveryEnvelope` reason `compromised_rotation`). Envelope
  replacement under the same VK is only `trusted_replacement` after proving the
  old kit.

## AAD / identity

- Every open path takes the **caller’s expectation** and compares before decrypt.
- Envelope `type`, `vault_id` / `vaultId`, `deviceId`, `credentialId`, `cryptoVersion`, `vaultKeyVersion`, `deviceKeyVersion`, and Argon2id parameters are bound (AAD or equivalent). Flipping them is `AuthFailureError` or `IntegrityError`.
- Entry decrypt is bound to the requested `entryId`. Serving X in Y’s slot is `IntegrityError`.

## Freshness

- `revision` is sealed in the snapshot manifest (AAD + digest of every entry and envelope).
- After a client pins revision N, an older authentic snapshot is `RollbackError`.
- Mixed envelopes/entries from two snapshots → `IntegrityError`.
- `vaultKeyVersion` and `deviceKeyVersion` must not go backwards.

## Revocation (honest names)

| Name | What it is |
|---|---|
| Metadata revoke | `DELETE /devices/{id}` sets `revoked_at`. Response `revocation: "metadata_only"` |
| Soft revoke | Next snapshot omits that device envelope |
| Hard revoke | New VK (`vaultKeyVersion++`), rewrap remaining devices |

Metadata revoke is not cryptographic erase. A device that already holds VK can still decrypt snapshots sealed under that VK.

## Server

- Stores opaque envelopes and ciphertext only.
- Issues and consumes one-time WebAuthn challenges. When the client sends the authenticator response, the server COSE-verifies it (`cose_verified`). The server never verifies PRF.
- Ownership: wrong id → 404, not 403.
- Snapshot publish is atomic (row lock + CAS + unique `(vault_id, revision)`).
- `FOURALLPASS_SESSION_SECRET` default is refused in production.

## Errors

Use the existing taxonomy (`ProtocolError`, `IntegrityError`, `AuthFailureError`, `RollbackError`). Do not swallow AEAD failures as generic 500s on the client, and do not leak whether a vault id exists to non-owners.
