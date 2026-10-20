# Device assertion binding: enforced boundary and AP04 remainder

This source correction implements a selector consistency prerequisite. It does
not establish an approved ThreadDesk person/device or a new team identity API.

## Enforced now

The existing authenticated owner-only challenge route consumes its one-time
challenge first. For an assertion, the credential must belong to the owned
vault and remain unrevoked together with its device. Its stored public device
identifier must match every explicit selector: the original challenge record
and the consume payload. A mismatch uses the same 404 as an unavailable
credential, before signature verification and usage updates. A matching
assertion still uses the existing pinned COSE verifier, RP/origin/challenge,
user-verification/signature and counter checks. No crypto construction changed.

Missing, reused, expired or changed challenge bindings remain 404. A failed
attempt consumes the challenge and does not automatically retry with another
credential. A newly issued challenge is a separate user ceremony.

Legacy challenges without selectors may still verify a credential in the
owned vault. A consume without assertion fields may still return 204 for
challenge hygiene. Neither response issues an admission receipt or team right.
`fmt=none`, client-posted device metadata and `cose_verified` are not trusted
hardware attestation or Vault-Key/PRF proof. Device registration is still
account-session-authorized metadata, with the existing honest limitations.

## Required AP04 contract, not implemented by this correction

The trust source for a person must be a configured authenticated account issuer
and its current server-side account mapping, not email text, copied IDs or a
Kira/agent name in JSON. Local bootstrap remains local vault use, not team identity.
A new team device needs a separately approved enrollment with fresh person
reauthentication and a verified challenge for its exact enrolled credential;
a stolen storage session must not be sufficient to approve its own new device.

A team-facing proof must be an opaque, single-use server result bound to that
person/device mapping, intended audience and specific operation, plus current
revocation/admission generation and expiry. Existing 204/credential flags are
not such a result. The team service must recheck admission/revocation and its
own current project role at dispatch. A stale backup, caller trust flag or
self-named device cannot reactivate an admission. Revocation stops new team
operations; erasing already held Vault Keys remains a separate rotation issue.

These are acceptance requirements for the still-unbuilt admission adapter,
not additional capabilities in the current source. Initial trusted enrollment,
reauthentication, monotonic admission/revocation state, real distinct-person/
device acceptance and the ThreadDesk adapter remain open. The existing
account-session snapshot-write gap and its signed-write design remain
[ADR-015](architecture/adr/ADR-015-write-authorization.md), not silently closed.
No new signing protocol, protected executor or role defaults are introduced.

[Actual synthetic checks and limits](evidence/device-assertion-binding-20261020/STATUS.md).
