# P04: explicit snapshot/manifest v2 library candidate

Status: development candidate in the existing default-off signed-write work.
This is not a new deployed vault protocol, an accepted migration, or an
end-to-end signed-write/bootstrap acceptance.

## Version boundary

`CRYPTO_PROTOCOL_VERSION` remains 1. Entry encryption, KeyEnvelope and
Device-Key Envelope formats remain 1. Snapshot/manifest version 2 is a separate,
explicit opt-in; it does not increment an entry format or key generation.

`buildManifest` takes `cryptoProtocolVersion: 2` to construct a v2 manifest.
`sealManifest`, `openManifest`, `verifySnapshotManifest`, `decodeManifest`,
`decodeSealedManifest` and `decodeVaultSnapshot` require the caller to pass
`cryptoProtocolVersion: 2` in their options for that path. Omission retains v1;
a server header cannot select v2 for a default-v1 caller. An explicit v2 reader
rejects v1 instead of retrying with v1 defaults. Encoders remain serialization,
not proof of authentication; untrusted wire data must pass the decoder and
manifest verification.

Version-2 snapshots require a version-2 sealed manifest, including revision 1.
The outer version, sealed version, expected AAD version and authenticated body
version must agree. Unsupported versions and unknown child encryption formats
are rejected. Entry schema versions and key generations remain distinct fields.

## Domain separation and authentication

The body label is `4allpass-manifest-content-v2`; the AAD label is
`4allpass-manifest-v2`. All framing, AEAD operations, child digests and v1 labels
are unchanged. The caller's vault ID, revision, key generation and protocol are
bound to AAD and compared with the authenticated body. Complete-set verification
still uses normalized copies of entries/envelopes and their exact digests.
V2 manifests continue to reference v1 entry and envelope encryption formats.
Plaintext manifest buffers are cleared on both successful and failed decoding.

## Backend syntactic binding

The development backend requires a sealed manifest from the first v2 snapshot
and rejects a declared manifest version that differs from the snapshot protocol.
The existing vault/snapshot protocol equality, signed-write authorization, replay
and CAS checks remain in force. The server keeps the manifest opaque; these
checks do not authenticate its plaintext or AAD. Synthetic signed-request tests
cover rejection without persisted state changes and preserve v1 bootstrap.

## Explicit revision/pin candidate

Revision evaluation and manifest-derived pins accept v2 only with an explicit
`cryptoProtocolVersion: 2` expectation. V2 requires a 32-byte manifest digest.
A previously pinned vault cannot change protocol in either direction; this is
not a migration API. Default callers continue to expect v1.

Pin persistence preserves the selected protocol and digest. Historical omission
of the stored protocol field means v1; malformed or unsupported stored pins
raise an error and remain intact rather than becoming a fresh first-use state.
These API primitives do not activate the v2 session path.

## Remaining integration boundaries

Frontend bootstrap/commit, unlock and offline session call sites still need an
explicit protocol expectation passed through decoding, authentication, revision
evaluation and pin adoption. This slice does not establish complete client
integration or old-client/packaged WKWebView/Tauri acceptance. Backend syntactic
binding is not end-to-end acceptance. No v1-to-v2 migration or product
feature-gate activation is introduced.

The broader proposal and its missing evidence remain in
[the ADR-015 amendment draft](../architecture/adr/ADR-015-P04-snapshot-versioning-draft.md).
The v1 specification and its fixed vectors remain authoritative for existing
callers. Tests exercise synthetic vectors only; no real vault or credential is
used. Local development evidence is not a released or installed app claim.
