# ADR-016: deny machine secret export; bounded protected executor core

Status: accepted scope from explicit user order 18 October 2026; production
secret execution boundary remains unavailable. Replaces the former assumption
that human Allow could authorize raw material delivery to an AI consumer.

The v1 frontend attached entry.password and called it access_token. That was not
a provider-minted scoped token. The core, frontend, both relays and access client
now reject this channel. Human vault, import, autofill and recovery are separate
and preserved. No vault cryptography or server decryption was added.

A separately trusted host may use the fixed synthetic API executor building
block. Request data contains a private use reference and G-01 binding, no secret.
TollGate's real local reserve/dispatch/stop boundary surrounds the synchronous
send; no exported Allow token. Only a bounded positive application response schema
can leave the core. There is no arbitrary URL, proxy or generic provider output.

A process/0600 file under the same agent-accessible UID is not isolation. Current
macOS shell/project grants therefore do not qualify for production secret use.
No real credential enters this building block until an inaccessible execution
boundary and trusted vault transfer plus KB-C02 origin binding are verified.
Browser login/session/DOM export protection is a distinct unfinished FP-C03.

See ../../PROTECTED-ACCESS-20261018.md for actual checks and source/release limits.

## Binding follow-up, 18 October 2026

Private metadata DTOs alone cannot authenticate the absent protected host. The
source now denies normal host-less execution before lookup; arbitrary callbacks,
booleans or dictionaries cannot enable it. Explicit synthetic fixtures use only
a fixed public dummy value. This is not a new authorization service or OS guard.

Grant/use metadata now bind consumer, configured origin/principal, exact request
hash and grant version in addition to G-01/operation/target. Strict finite lifetime
and lifecycle validation repeat inside the actual TollGate callback. No plaintext
field exists in the public Grant DTO. Real host/consent source and its monotonic
version/revoke history, vault transfer and OS isolation remain prerequisites;
FP-C02/FP-C03 stay productively open. No human vault or cryptography change.
