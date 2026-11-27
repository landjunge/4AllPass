# Signed-write replay receipt digest

This documents the existing `4allpass-write-receipt-v1` response digest contract
for the four signed-write finalize routes. It does not define an authentication
mechanism: `responseDigest` is an unkeyed consistency checksum over `result`.
It does not prove who produced a receipt, authorize a write, or authenticate a
snapshot.

## Receipt result schemas

All four routes emit exactly these result properties:

```json
{"manifestDigest":null,"resourceState":"active","revision":0,"vaultKeyVersion":0}
```

`manifestDigest` is `null` or 64 lowercase hexadecimal characters. `revision`
and `vaultKeyVersion` are integers in `[0, 2^32 - 1]`. The route fixes
`resourceState` and the outer receipt resource type:

| Route | Resource type | Allowed resourceState |
| --- | --- | --- |
| `/api/v1/vaults/{vaultId}/snapshots` | `vault` | `active` |
| `/api/v1/vaults/{vaultId}/devices` | `device` | `active`, `revoked` |
| `/api/v1/vaults/{vaultId}/devices/{deviceId}/credentials` | `credential` | `active` |
| `/api/v1/vaults/{vaultId}/devices/{deviceId}/credentials/{credentialId}/device-key-envelope` | `credential` | `active` |

The complete receipt has the exact v1 keys `schema`, `operationId`, `vaultId`,
`route`, `resource`, `outcome`, `result`, `replayable`, `bodyAvailable`,
`responseDigest`, and `createdAt`. Resource keys are `type`, `id`, `parentId`;
outcome keys are `status`, `code`. A successful replay requires `replayable: true`,
`bodyAvailable: false`, and outcome status/code matching the HTTP response and
`200..299` / `ok` respectively.

## Digest bytes

The server computes SHA-256 over UTF-8 bytes of Python's
`json.dumps(result, sort_keys=True, separators=(",", ":"))`, retaining the
default `ensure_ascii=True`. Since the accepted result has only four fixed ASCII
keys and string, null, and uint32 integer values, the client constructs that
exact compact, lexically sorted JSON form and uses Python-compatible lowercase
`\uXXXX` escapes (including UTF-16 surrogate pairs) for non-ASCII string code
units. The receipt contains the lowercase hexadecimal SHA-256 digest.

Shared vectors in `packages/crypto/test/fixtures/write-receipt-vectors.json`
pin route results, canonical JSON bytes, and digests. Unsupported JavaScript
values such as undefined, non-finite/fractional numbers, booleans in integer
slots, arrays, maps, and nested objects fail closed; they are not normalized or
coerced into a broader canonicalization protocol.

## Replay handling

A missing, malformed, or mismatched digest makes the replay classification
`unknown`. The client must not infer success from that receipt or use its
`result` as a snapshot. After a valid receipt, the caller still obtains current
state through its separately authorized read path. The digest is not a MAC,
signature, authorization claim, or replacement for that read.
