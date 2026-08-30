# Security

4AllPass is a Zero-Knowledge password manager **for the bundled desktop client** (and for a PWA only if you trust the code host). A live exploit against wrapping, CAS, or the claim surface is a **private** report, not a public issue.

## How to report

Use [GitHub private vulnerability reporting](https://github.com/landjunge/4AllPass/security/advisories/new).

Do **not** file a public issue for an exploit. The “Security gap” issue template is for documented honesty gaps and adversarial findings that are already in `docs/`, not for 0-days.

## Never paste

Do not include any of the following in an issue, PR, advisory, log, or screenshot:

- Master password, account password, or recovery key
- Vault Key, Device Key, Device Wrapping Key, or WebAuthn PRF output
- Unencrypted vault exports or snapshot blobs that still wrap live keys
- Session tokens

Describe the attack with a **reproduction against a throwaway vault**, a failing test, or a redacted trace.

## What we treat as in-scope

- Client crypto in `packages/crypto` and `packages/webauthn`
- Snapshot CAS, ownership 404s, and session handling in `backend/`
- PWA / extension paths that decrypt on-device
- Over-claims in `docs/` or UI copy that the running code does not enforce

Out of scope until they exist: native apps, org/team features, wrapping a key to a foreign Device Key. Item-share files (`docs/sharing.md`) are in-scope as client-side packages, not as server ACLs.

Map for a third-party auditor: [`docs/audit-scope.md`](docs/audit-scope.md). What the running system actually enforces: [`docs/security-boundary.md`](docs/security-boundary.md).

## Soft vs hard revoke

`DELETE /devices` is metadata only. Soft revoke omits that device envelope on the next snapshot. Hard revoke rotates the vault key (`vaultKeyVersion`++, CAS, then delete). Do not report “DELETE did not erase the key” as a vuln; that is the documented model.
