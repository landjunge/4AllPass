# E03 / P04 devices and WebAuthn · P05 recovery, revoke and history

Base: `6499c7c9be3b8463f7619db24887212760a24395` (after P03, #265). Environment as
in `../e03-p00-p01-20261110/STATUS.md`. No code change in either section; this
file records what was checked. Plan source and status: ThreadDesk.

## P04 — partly checked (real hardware and native webview blocked)

Read: `packages/webauthn/src` (enable, unlock, prf, large-blob, challenge,
authenticator-data), backend `core/challenges.py`, `core/webauthn_cose.py`,
`routes/webauthn.py`, device routes, frontend `DevicesPanel`/`UnlockPage`.

- Challenges: 32 random bytes, digest stored, bound to account, vault, purpose
  and optional device; consumed with `GETDEL`/pop before the comparison, so a
  wrong guess also burns it; foreign, replayed or rebound challenges are 404.
- Assertions: rpId checked against configuration, origin list exact in
  production, same-origin context required, sign count advanced, revoked
  device or credential refused.
- PRF: eval input `SHA-256(label, rpId, vaultId)`, DWK only via HKDF, all
  identities from the caller's expectation (P01). A copied credential id or
  server mirror of the Device-Key Envelope opens nothing without the
  authenticator (rank 1/2) or the local wrapping key (rank 3).
- Fallback rank is shown honestly: rank 3 is labelled "UV-gated local store
  (rank 3 — policy only)"; the code states that the UV assertion is the only
  gate in front of local key material.

Not proven here: PRF/largeBlob on named real hardware and in the native
desktop webview — needs a human ceremony on that device.

## P05 — complete within scope

Read: `vault-session.ts` (`replaceTrustedRecoveryKey`, `rotateCompromisedRecovery`,
hard revoke, history, head recovery), `historic-snapshot.ts`, `recovery.ts`.

- Compromised kit: fresh VK (`vaultKeyVersion + 1`), new recovery key, new
  master salt, entries re-sealed under the new VK; other devices must re-enrol.
- Trusted replacement only after the old kit opens the current envelope.
- History and head recovery never write pin or cache; restore is a forward
  commit N+1 (now also guarded by the P02 commit-echo check).
- A revision under an earlier VK is reported unreadable, not opened.
- Remaining limit: superseded revisions stay on the server under the old VK,
  so a stolen old kit still opens pre-rotation history. Inherent to rotation.

## Test runs

| Command | Result |
|---|---|
| `npm run test:webauthn` | 44/44 |
| backend WebAuthn tests (challenge, COSE, policy, device binding) | pass (part of 229/230) |
| Playwright, Chrome headless, virtual authenticator: `device-unlock.spec.ts`, `two-device.spec.ts` (isolated backend on 127.0.0.1:8099, throwaway SQLite; Vite on :5199) | 8/8 (PRF, largeBlob, UV-local, no plaintext on server, revoked device, hard revoke, wrong password, second profile) |
| Playwright `playwright.local.config.ts` (temp data dirs): `poisoned-head-recovery`, `vault-history` | 2/2 |
| frontend unit suites for recovery rotation, hard revoke, history, head recovery | pass (part of 265/265) |
