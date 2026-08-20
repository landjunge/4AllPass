# Contributing to 4AllPass

`docs/` is authoritative. If code and `packages/crypto` disagree, the library and its tests win. Read `docs/security-boundary.md` before changing running behaviour.

## Zero-Knowledge

The server must never receive or derive: master password, vault key, device key, device wrapping key, WebAuthn PRF output, or plaintext entries. The account password is only for the session. It cannot unwrap a vault.

## Layout

| Path | May do | Must not do |
|---|---|---|
| `packages/crypto` | Protocol v1, pure functions | UI, network, authenticator I/O |
| `packages/webauthn` | PRF > largeBlob > UV-gated store | Vault crypto (call `@4allpass/crypto`) |
| `backend` | Accounts, ownership, snapshot CAS, opaque blobs | Decrypt or “verify” PRF |
| `frontend` / `extension` | All cryptography | Trust server metadata as crypto proof |

## Checks

```sh
npm test
npm run test:webauthn
npm run typecheck
cd backend && pytest
```

New crypto behaviour needs an adversarial or KAT test in the matching class (`adversarial-aead|identity|freshness|kdf-prf|toctou`). Update the spec in the same PR if the claim surface changes.

Do not claim `DELETE /devices` erased a key. Soft revoke omits the envelope; hard revoke rotates the vault key (`hardRevokeDevice`).

## Imports

Bitwarden JSON and CSV imports are plaintext until the user confirms. The PWA encrypts on the device, then commits. Do not upload the export file to the server.

## Issues / PRs

Use the GitHub templates. One theme per PR. Prefer rebasing an existing branch over opening a fifth parallel attempt at the same gap.
