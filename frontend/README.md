# 4AllPass web client (React + TypeScript + PWA)

All cryptography happens here. The server only ever receives wrapped envelopes,
encrypted entries, and device metadata.

```
src/
  lib/
    api.ts              typed API client (session token, base64 wire format)
    device-identity.ts  stable per-profile device id, rpId, coarse device label
    revision-pin.ts     locally pinned (vaultId, revision, vaultKeyVersion)
    entries.ts          plaintext entry schema + password generator
    recovery-key.ts     base32 Emergency Kit format
    vault-session.ts    create / unlock / commit / device unlock engine
  state/app-state.tsx   lock lifecycle (LOCKED → UNLOCKING → UNLOCKED → LOCKING)
  pages/                AuthPage, CreateVaultPage, UnlockPage, VaultPage
  components/           DevicesPanel, RecoveryKitDialog
```

## Run

```sh
npm install                 # from the repository root
npm run dev -w @4allpass/web # expects the backend on 127.0.0.1:8000
npm run build -w @4allpass/web
```

`VITE_API_TARGET` overrides the dev proxy target.

## Flows

**Create vault.** Reserve a `vault_id`, generate a random Vault Key, derive the
Master Key with Argon2id (profile selectable, parameters stored in the master
envelope), wrap the Vault Key into a master and a recovery envelope, commit
revision 1, then show the Emergency Kit once.

**Unlock.** Fetch the snapshot at `active_revision`, refuse a rollback against
the local pin, unwrap the Vault Key, verify that every envelope this device can
open yields the same Vault Key and that every entry decrypts, then decrypt into
memory.

**Device unlock.** With the vault open, `@4allpass/webauthn` provisions the best
available rank (PRF, largeBlob, UV-gated local store), the Device Envelope goes
to the server, and the PRF Device-Key Envelope may be mirrored as an opaque
blob. Unlocking runs assertion → DWK → Device Key → Vault Key. Any failure falls
back to the master password.

**Save.** Every commit re-seals all entries with fresh nonces and posts revision
N+1 with `expectedRevision`, so a racing client gets a conflict instead of
clobbering data.

## Lock lifecycle

The Vault Key is zeroized on manual lock, after five minutes of inactivity, and
when the tab is hidden. Entry passwords and notes are cleared with it. JavaScript
cannot guarantee erasure of every copy; that limit is accepted in the threat
model.

## PWA

`vite-plugin-pwa` precaches the app shell only. There is no runtime caching, so
no API response and no encrypted vault data is ever written to a cache. `sw.js`
is served with `no-store` by the bundled nginx config.

## Not implemented yet

Hard revocation with Vault Key rotation is supported by the crypto core and the
API (`vaultKeyVersion + 1`), but the UI currently offers soft revocation only.
