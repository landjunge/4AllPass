# Account module

Owns the signed-in email, the short-lived account-password reference, and the
commands for registration, sign-in, local sign-in, and sign-out.

- The account password is retained only in memory to warn against reusing it as
  the vault password. It is cleared on restored/local sessions and before logout.
- Vault loading, locking, and cleanup are invoked only through callbacks.
- The module never receives vault plaintext, a Vault Key, envelopes, snapshots,
  revisions, or recovery material.
- API token persistence remains in `lib/api.ts`.

Other code imports only from `modules/account/index.ts`.
