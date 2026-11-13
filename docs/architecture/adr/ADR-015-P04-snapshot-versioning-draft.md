# ADR-015 amendment draft — P04 snapshot and manifest version binding

Status: technical proposal, not accepted or implemented.
Date: 2026-11-13.
Related: ADR-005, ADR-015, `crypto-protocol.md`, `vault-revision.md`.
The product decision and execution status remain in ThreadDesk 4AllPass entries
147–148 (`7dd7ab68ab80`); this document specifies a candidate wire contract.

## Problem

The opt-in signed-write client currently sends a snapshot whose
`cryptoProtocolVersion` is 2 while creating a manifest with version 1.
The existing shared library deliberately rejects snapshot version 2.
Accepting another number in the decoder, or changing the global v1 constant,
would not establish an authenticated, interoperable v2 snapshot.

The deployed v1 format and its rejection of unknown formats remain authoritative.
This proposal does not enable signed writes, migrate data, or weaken a decoder.

## Proposed interpretation

Retain ADR-015's existing server gate: snapshot protocol 2 requires signed writes.
Distinguish the snapshot/write protocol from each encrypted child record's format:

| Object | Existing contract | Proposed signed-write contract |
| --- | --- | --- |
| Snapshot protocol | 1 | 2 |
| Sealed manifest version and authenticated body version | 1 | 2 |
| Envelope encryption format | 1 | 1, unchanged |
| Entry encryption format | 1 | 1, unchanged |
| Vault/key generation | Independent positive generation | Independent positive generation |

Do not change `CRYPTO_PROTOCOL_VERSION` globally. Introduce a separately named,
finite snapshot protocol validator for exactly 1 and 2. Envelope and entry
validators keep their existing supported-format checks. A newer generation is
not a newer encryption format.

## Manifest contract

1. A protocol-2 snapshot must contain a sealed manifest of version 2. Version 2
   never takes the manifestless legacy path.
2. A v2 manifest uses distinct body and AAD domain labels:
   `4allpass-manifest-content-v2` and `4allpass-manifest-v2`.
   Existing v1 labels, framing, ciphertexts and vectors remain byte-for-byte
   unchanged.
3. The authenticated header binds vault ID, snapshot protocol, revision and
   vault-key generation, using the existing framed integer encoding.
4. The outer snapshot version, sealed manifest version, expected AAD version
   and decoded manifest body version must agree. The caller supplies its
   expected snapshot protocol explicitly for v2; the implementation must not
   infer permission from an untrusted sealed header.
5. The manifest continues to authenticate the exact normalized entry/envelope
   set and its digests. Existing ciphertext, child format/version and identity
   checks remain in force. Unknown child formats are rejected independently.
6. An expected-v2 open never retries with v1 labels or defaults after an error.

## Freshness and adoption

The client obtains a version-2 pin only from a successfully authenticated v2
manifest, together with the digest of the exact sealed blob that was verified.
It adopts the pin only after all content integrity, plaintext decoding and
existing session-liveness checks succeed. Server metadata alone cannot create
or advance a pin.

Pin persistence must retain the authenticated snapshot protocol instead of
hard-coding 1. Legacy stored pins with no protocol field retain their historical
v1 meaning. Invalid or unsupported explicit stored versions must neither silently become
v1 nor be discarded as a missing pin. Refuse the open without replacing the
record; any recovery/reset must use a separately defined, explicit local
recovery procedure. This draft does not authorize such a reset.
A pinned v2 vault rejects a v1 response, including a response with a higher
claimed revision or key generation. No automatic v1-to-v2 data migration is
introduced by this proposal. Protocol 2 is limited to newly created v2 vaults.
The vault protocol is immutable within this scope; snapshot writes must match
the vault's selected protocol. An existing v1 vault cannot opt into v2 merely
by presenting a higher snapshot version. A future migration needs a separate
authenticated transition contract.

A client without an existing pin still has the documented pin-on-first-use
limit: it cannot distinguish an older authentic first snapshot from the newest
one using the manifest alone. These rules preserve subsequent rollback
protection; they do not prove freshness before a trustworthy initial pin.

## Server and client boundaries

Required implementation change: the server must reject a missing manifest for
protocol 2 even at the initial snapshot/revision 1, reject mismatched declared
snapshot and sealed-manifest versions, and reject a snapshot protocol that
differs from the vault protocol. These checks are not all present today. The
current bootstrap permits a missing manifest and does not enforce the complete
version binding; this proposal must not be read as an implementation claim.
The server cannot authenticate the opaque manifest plaintext
or AAD; that remains the client's job. Existing ownership, signature, replay,
revocation and CAS checks remain independent requirements.

The implementation must preserve the existing default-off gate and unchanged
v1 path. The extension remains a reader of its supported formats. An old client
must fail closed on v2 rather than reinterpret it.

## Required evidence before accepting or enabling the contract

- Existing v1 wire, manifest, AAD, revision and content-opening vectors remain
  unchanged and pass.
- A v2 snapshot with an authenticated v2 manifest and unchanged v1 child records
  can be encoded, decoded and opened using the ordinary shared-library path.
- Missing manifests; v1/v2 outer, sealed, AAD and body mismatches; wrong vault,
  revision or key generation; altered record sets and unknown child formats
  fail closed, without changing the previous freshness pin.
- A verified v2 pin survives persistence and rejects downgrade to v1.
- A full opt-in bootstrap, signed commit, explicit exact replay and authorized
  readback works through the packaged WKWebView/Tauri path. Mocked unit tests
  alone do not establish this evidence.
- Backend default-off, v1 compatibility, signature enforcement, replay and CAS
  checks pass on the same exact candidate.

- Old-client and extension readers reject v2 explicitly; do not claim their
  acceptance from new-client tests.
- On acceptance, update `crypto-protocol.md`, `vault-revision.md` and
  `crypto/versioning.md` together with the implementing code and vectors.
  The draft alone does not supersede those current documents.

## Alternative

A separate `writeAuthorizationVersion` would keep the encryption protocol name
narrower, but changes ADR-015's existing gate and requires coordinated database,
API, model, client and migration changes. It is a distinct contract decision;
this proposal does not implement it.

## Current status

Only this technical proposal is added. No protocol validator, cryptographic
operation, feature gate, installed app or stored vault is changed. Acceptance
of the proposal and implementation/package evidence remain open.
