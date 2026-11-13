// Independent reference generator for the canonical v2 WriteRequest vectors.
//
// Normative source: SIGNED-WRITE-CONTRACT-v2 §1 plus the private
// V3-ERRATUM-2 device-binding delta (Draft Layout Rev2). This file imports
// NOTHING from ../../src or backend/: it is a second, from-the-spec
// implementation whose only job is to pin the fixture both real
// implementations must reproduce.
//
//   frame([ "4allpass-vault-write-v2", vaultId, deviceId, method, route,
//           resourceType, resourceId, parentId, baseRevision, resultRevision,
//           signingKeyVersion, resultKeyVersion, hasManifest, manifestDigest,
//           payloadDigest, hasNextKey, nextPublicKeyDigest, operationId,
//           nonce, timestamp ])
//
// Every field is uint32be-length-prefixed (`frame`); presence flags are framed
// uint32 0|1 and the optional digests are framed empty arrays when absent.
//
// Ed25519 signatures use the RFC 8032 §7.1 TEST 1 seed. Ed25519 is
// deterministic, so the expected signature is a hard cross-language value; its
// correctness is anchored by the RFC 8032 vectors, not by the two
// implementations agreeing with each other.
//
// Run: node packages/crypto/test/fixtures/generate-write-request-vectors.mjs
import { createHash, createPrivateKey, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "4allpass-vault-write-v2";
const PUBLIC_KEY_LABEL = "4allpass-write-public-key-v1";
const DRAFT_LAYOUT_REVISION = 2;
const SCHEMA_REVISION = 2;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest();
const hex = (bytes) => Buffer.from(bytes).toString("hex");
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

function u32(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error(`bad u32 ${n}`);
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}
const framed = (bytes) => Buffer.concat([u32(Buffer.from(bytes).length), Buffer.from(bytes)]);
const framedStr = (s) => framed(Buffer.from(s, "utf8"));
const framedU32 = (n) => framed(u32(n));

function preimage(req) {
  return Buffer.concat([
    framedStr(LABEL),
    framedStr(req.vaultId),
    framedStr(req.deviceId),
    framedStr(req.method),
    framedStr(req.route),
    framedStr(req.resourceType),
    framedStr(req.resourceId),
    framedStr(req.parentId),
    framedU32(req.baseRevision),
    framedU32(req.resultRevision),
    framedU32(req.signingKeyVersion),
    framedU32(req.resultKeyVersion),
    framedU32(req.hasManifest),
    framed(req.manifestDigest),
    framed(req.payloadDigest),
    framedU32(req.hasNextKey),
    framed(req.nextPublicKeyDigest),
    framedStr(req.operationId),
    framed(req.nonce),
    framedU32(req.timestamp),
  ]);
}

const RFC8032 = [
  {
    name: "rfc8032-test1-empty",
    secret_key_hex: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    public_key_hex: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    message_hex: "",
    signature_hex:
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  },
  {
    name: "rfc8032-test2-one-byte",
    secret_key_hex: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    public_key_hex: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    message_hex: "72",
    signature_hex:
      "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
  },
];

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
function signWithTest1(message) {
  const seed = Buffer.from(RFC8032[0].secret_key_hex, "hex");
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  return sign(null, message, key);
}

const ROUTES = {
  snapshot: "/api/v1/vaults/{vaultId}/snapshots",
  device: "/api/v1/vaults/{vaultId}/devices",
  deviceDelete: "/api/v1/vaults/{vaultId}/devices/{deviceId}",
  credential: "/api/v1/vaults/{vaultId}/devices/{deviceId}/credentials",
  envelope:
    "/api/v1/vaults/{vaultId}/devices/{deviceId}/credentials/{credentialId}/device-key-envelope",
  challenge: "/api/v1/vaults/{vaultId}/webauthn/challenges",
  challengeConsume: "/api/v1/vaults/{vaultId}/webauthn/challenges/{challengeId}/consume",
};

const VAULT = "6f0c1c1a-3f4e-4c1d-9a7e-2b8d0f5a1c33";
const OP = "0b9d2b7e-5a41-4c8f-8f0e-6d1c2a3b4c5d";
const NONCE = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
const NEXT_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7) & 0xff));

const nextKeyDigest = sha256(Buffer.concat([framedStr(PUBLIC_KEY_LABEL), framed(NEXT_KEY)]));

function baseFields(over = {}) {
  return {
    vaultId: VAULT,
    deviceId: "dev-01",
    method: "POST",
    route: ROUTES.snapshot,
    resourceType: "vault",
    resourceId: "",
    parentId: "",
    baseRevision: 0,
    resultRevision: 1,
    signingKeyVersion: 1,
    resultKeyVersion: 1,
    hasManifest: 0,
    manifestDigest: Buffer.alloc(0),
    hasNextKey: 0,
    nextPublicKeyDigest: Buffer.alloc(0),
    operationId: OP,
    nonce: NONCE,
    timestamp: 1763000000,
    ...over,
  };
}

function wireOf(req, payloadDigest) {
  return {
    vaultId: req.vaultId,
    deviceId: req.deviceId,
    method: req.method,
    route: req.route,
    resourceType: req.resourceType,
    resourceId: req.resourceId,
    parentId: req.parentId,
    baseRevision: req.baseRevision,
    resultRevision: req.resultRevision,
    signingKeyVersion: req.signingKeyVersion,
    resultKeyVersion: req.resultKeyVersion,
    hasManifest: req.hasManifest,
    manifestDigest: b64url(req.manifestDigest),
    payloadDigest: b64url(payloadDigest),
    hasNextKey: req.hasNextKey,
    nextPublicKeyDigest: b64url(req.nextPublicKeyDigest),
    operationId: req.operationId,
    nonce: b64url(req.nonce),
    timestamp: req.timestamp,
  };
}

function valid(name, req, body, note) {
  const bodyBytes = Buffer.from(body, "utf8");
  const payloadDigest = sha256(bodyBytes);
  const bytes = preimage({ ...req, payloadDigest });
  return {
    name,
    note,
    wire: wireOf(req, payloadDigest),
    body_b64url: b64url(bodyBytes),
    payload_digest_hex: hex(payloadDigest),
    preimage_hex: hex(bytes),
    sha256_hex: hex(sha256(bytes)),
    signature_hex: hex(signWithTest1(bytes)),
  };
}

const MANIFEST = sha256(Buffer.from("manifest-a"));
const MANIFEST_B = sha256(Buffer.from("manifest-b"));
const DEVICE_128_EMOJI = "\u{1f600}".repeat(128);

const validVectors = [
  valid("snapshot_rev0_no_manifest", baseFields(), '{"entries":[]}', "first snapshot: hasManifest=0, empty digest"),
  valid(
    "snapshot_rev5_with_manifest",
    baseFields({
      baseRevision: 5,
      resultRevision: 6,
      hasManifest: 1,
      manifestDigest: MANIFEST,
      timestamp: 0xffffffff,
    }),
    '{"entries":[{"id":"a"}]}',
    "hasManifest=1 and the uint32 timestamp ceiling",
  ),
  valid(
    "rotation_next_key",
    baseFields({
      baseRevision: 3,
      resultRevision: 4,
      signingKeyVersion: 2,
      resultKeyVersion: 3,
      hasManifest: 1,
      manifestDigest: MANIFEST_B,
      hasNextKey: 1,
      nextPublicKeyDigest: nextKeyDigest,
    }),
    '{"entries":[]}',
    "rotation: resultKeyVersion K+1, hasNextKey=1",
  ),
  valid(
    "device_post_unicode_quotes",
    baseFields({
      route: ROUTES.device,
      resourceType: "device",
      resourceId: "dev\u201csmart\u201d",
      deviceId: "dev\u201csmart\u201d",
      baseRevision: 7,
      resultRevision: 7,
    }),
    '{"label":"phone"}',
    "U+201C/U+201D preserved verbatim in resourceId and deviceId",
  ),
  valid(
    "device_post_128_emoji",
    baseFields({
      route: ROUTES.device,
      resourceType: "device",
      resourceId: DEVICE_128_EMOJI,
      deviceId: DEVICE_128_EMOJI,
      baseRevision: 7,
      resultRevision: 7,
    }),
    "{}",
    "128 code points = 512 UTF-8 bytes for deviceId and resourceId",
  ),
  valid(
    "credential_post_nfc",
    baseFields({
      route: ROUTES.credential,
      resourceType: "credential",
      resourceId: "cred\u00e9",
      parentId: "dev-01",
      baseRevision: 9,
      resultRevision: 9,
    }),
    "{}",
    "precomposed NFC",
  ),
  valid(
    "credential_post_nfd",
    baseFields({
      route: ROUTES.credential,
      resourceType: "credential",
      resourceId: "crede\u0301",
      parentId: "dev-01",
      baseRevision: 9,
      resultRevision: 9,
    }),
    "{}",
    "decomposed NFD: must NOT be normalized to the NFC vector",
  ),
  valid(
    "envelope_put",
    baseFields({
      method: "PUT",
      route: ROUTES.envelope,
      resourceType: "credential",
      resourceId: "cred:01",
      parentId: "dev-01",
      baseRevision: 12,
      resultRevision: 12,
    }),
    '{"envelope":"mirror"}',
    "Q3: resourceType=credential, resourceId=credentialId, parentId=deviceId",
  ),
  valid(
    "device_id_trailing_lf",
    baseFields({
      route: ROUTES.device,
      resourceType: "device",
      resourceId: "dev-01\n",
      deviceId: "dev-01\n",
      baseRevision: 7,
      resultRevision: 7,
    }),
    "{}",
    "opaque id: a trailing LF is part of the value, not whitespace to trim",
  ),
  valid(
    "challenge_issue_bytes",
    baseFields({
      route: ROUTES.challenge,
      resourceType: "challenge",
      resourceId: "dev-01",
      parentId: "",
      baseRevision: 12,
      resultRevision: 12,
      hasManifest: 1,
      manifestDigest: MANIFEST,
    }),
    "{}",
    "bytes for a challenge resource; V3 D7 excludes these routes from VK signing",
  ),
];

function wire(over = {}) {
  const base = {
    vaultId: VAULT,
    deviceId: "dev-01",
    method: "POST",
    route: ROUTES.device,
    resourceType: "device",
    resourceId: "dev-01",
    parentId: "",
    baseRevision: 1,
    resultRevision: 1,
    signingKeyVersion: 1,
    resultKeyVersion: 1,
    hasManifest: 1,
    manifestDigest: b64url(MANIFEST),
    payloadDigest: b64url(sha256(Buffer.from("{}"))),
    hasNextKey: 0,
    nextPublicKeyDigest: "",
    operationId: OP,
    nonce: b64url(NONCE),
    timestamp: 1763000000,
  };
  return { ...base, ...over };
}

const nonceB64 = b64url(NONCE);
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const last = ALPHABET.indexOf(nonceB64[nonceB64.length - 1]);
const nonCanonical = nonceB64.slice(0, -1) + ALPHABET[last ^ 1];

function invalid(name, over, code, note) {
  return { name, wire: wire(over), code, note };
}

const invalidVectors = [
  invalid("vault_id_empty", { vaultId: "" }, "write_request_uuid_invalid", "vaultId is a UUID"),
  invalid("vault_id_uppercase", { vaultId: VAULT.toUpperCase() }, "write_request_uuid_invalid", "canonical lowercase only"),
  invalid("vault_id_braces", { vaultId: "{" + VAULT + "}" }, "write_request_uuid_invalid", "no braces"),
  invalid("operation_id_urn", { operationId: "urn:uuid:" + OP }, "write_request_uuid_invalid", "no urn:uuid"),
  invalid("operation_id_short", { operationId: OP.slice(0, 35) }, "write_request_uuid_invalid", "exactly 36 chars"),
  invalid("device_id_empty", { deviceId: "" }, "write_request_id_invalid", "deviceId is 1..128"),
  invalid("device_id_129_chars", { deviceId: "d".repeat(129) }, "write_request_id_invalid", "one past the bound"),
  invalid("device_id_lone_surrogate", { deviceId: "dev\ud800" }, "write_request_id_invalid", "no UTF-8 encoding"),
  invalid("device_id_null", { deviceId: null }, "write_request_type_invalid", "null is not a string"),
  invalid("id_129_chars", { resourceId: "d".repeat(129) }, "write_request_id_invalid", "one past the bound"),
  invalid("id_lone_surrogate", { resourceId: "dev\ud800" }, "write_request_id_invalid", "no UTF-8 encoding exists"),
  invalid("base_revision_2_pow_32", { baseRevision: 4294967296 }, "write_request_uint32_invalid", "uint32 overflow"),
  invalid("base_revision_negative", { baseRevision: -1 }, "write_request_uint32_invalid", "negative"),
  invalid("base_revision_float", { baseRevision: 1.5 }, "write_request_uint32_invalid", "fractional number"),
  invalid("base_revision_string", { baseRevision: "1" }, "write_request_type_invalid", "string is not a number"),
  invalid("result_revision_overflow", { resultRevision: 4294967296 }, "write_request_uint32_invalid", "uint32 overflow"),
  invalid("timestamp_negative", { timestamp: -1 }, "write_request_uint32_invalid", "negative"),
  invalid("nonce_15_bytes", { nonce: b64url(Buffer.alloc(15)) }, "write_request_nonce_invalid", "nonce is 16 bytes"),
  invalid("nonce_17_bytes", { nonce: b64url(Buffer.alloc(17)) }, "write_request_nonce_invalid", "nonce is 16 bytes"),
  invalid("payload_digest_31", { payloadDigest: b64url(Buffer.alloc(31)) }, "write_request_digest_invalid", "payloadDigest is 32 bytes"),
  invalid("manifest_digest_31", { manifestDigest: b64url(Buffer.alloc(31)) }, "write_request_digest_invalid", "hasManifest=1 needs 32 bytes"),
  invalid("manifest_present_but_empty", { manifestDigest: "" }, "write_request_digest_invalid", "hasManifest=1 with empty digest"),
  invalid("manifest_absent_but_32", { hasManifest: 0 }, "write_request_digest_invalid", "hasManifest=0 must carry an empty digest"),
  invalid("next_key_absent_but_32", { nextPublicKeyDigest: b64url(Buffer.alloc(32)) }, "write_request_digest_invalid", "hasNextKey=0 must carry an empty digest"),
  invalid("has_manifest_2", { hasManifest: 2 }, "write_request_presence_invalid", "flag is 0 or 1"),
  invalid("has_next_key_2", { hasNextKey: 2 }, "write_request_presence_invalid", "flag is 0 or 1"),
  invalid("base64_padding", { nonce: nonceB64 + "==" }, "write_request_base64_invalid", "padding is not canonical"),
  invalid("base64_standard_alphabet", { nonce: "+" + nonceB64.slice(1) }, "write_request_base64_invalid", "url alphabet only"),
  invalid("base64_nonzero_padding_bits", { nonce: nonCanonical }, "write_request_base64_invalid", "non-zero trailing bits"),
  invalid("base64_whitespace", { nonce: nonceB64.slice(0, 8) + " " + nonceB64.slice(8) }, "write_request_base64_invalid", "no whitespace"),
  invalid("method_lowercase", { method: "post" }, "write_request_method_invalid", "upper-case token"),
  invalid("method_empty", { method: "" }, "write_request_method_invalid", "non-empty token"),
  invalid("route_with_query", { route: ROUTES.device + "?x=1" }, "write_request_route_invalid", "no query"),
  invalid("route_with_fragment", { route: ROUTES.device + "#frag" }, "write_request_route_invalid", "no fragment"),
  invalid("route_relative", { route: "/vaults/1/devices" }, "write_request_route_invalid", "must be an /api/v1/ template"),
  invalid("resource_type_unknown", { resourceType: "envelope" }, "write_request_resource_type_invalid", "enum is vault/device/credential/challenge"),
  invalid("resource_id_null", { resourceId: null }, "write_request_type_invalid", "null is not a string in any language"),
  invalid("parent_id_missing_number", { parentId: 5 }, "write_request_type_invalid", "number is not a string"),
  invalid("unknown_field", { body: "e30" }, "write_request_field_unknown", "body travels as payloadDigest"),
];

// A trailing line terminator must never be ignored by the strict fields.
const TERMINATORS = {
  lf: "\n",
  cr: "\r",
  crlf: "\r\n",
  line_separator: "\u2028",
  paragraph_separator: "\u2029",
};
for (const [suffix, terminator] of Object.entries(TERMINATORS)) {
  invalidVectors.push(
    invalid(`vault_id_${suffix}`, { vaultId: VAULT + terminator }, "write_request_uuid_invalid", "absolute UUID end"),
    invalid(`operation_id_${suffix}`, { operationId: OP + terminator }, "write_request_uuid_invalid", "absolute UUID end"),
    invalid(`method_${suffix}`, { method: "POST" + terminator }, "write_request_method_invalid", "absolute method end"),
    invalid(`route_${suffix}`, { route: ROUTES.device + terminator }, "write_request_route_invalid", "absolute route end"),
  );
}

function missing(name, drop, code) {
  const w = wire();
  delete w[drop];
  return { name, wire: w, code, note: `missing ${drop}` };
}
invalidVectors.push(missing("missing_operation_id", "operationId", "write_request_type_invalid"));
invalidVectors.push(missing("missing_timestamp", "timestamp", "write_request_type_invalid"));
invalidVectors.push(missing("missing_device_id", "deviceId", "write_request_type_invalid"));

// One-field tamper set: every signed field except the presence flags (covered by
// the invalid vectors) is changed alone and must yield a different preimage.
const tamperBase = wire({
  baseRevision: 3,
  resultRevision: 4,
  signingKeyVersion: 2,
  resultKeyVersion: 3,
  hasNextKey: 1,
  nextPublicKeyDigest: b64url(nextKeyDigest),
});
const tamperCases = [
  { field: "vaultId", value: "11111111-2222-4333-8444-555555555555" },
  { field: "deviceId", value: "dev-02" },
  { field: "method", value: "PUT" },
  { field: "route", value: ROUTES.device + "/extra" },
  { field: "resourceType", value: "credential" },
  { field: "resourceId", value: "dev-02" },
  { field: "parentId", value: "parent-1" },
  { field: "baseRevision", value: 4 },
  { field: "resultRevision", value: 5 },
  { field: "signingKeyVersion", value: 3 },
  { field: "resultKeyVersion", value: 2 },
  { field: "manifestDigest", value: b64url(sha256(Buffer.from("manifest-other"))) },
  { field: "payloadDigest", value: b64url(sha256(Buffer.from("{} "))) },
  { field: "nextPublicKeyDigest", value: b64url(sha256(Buffer.from("next-other"))) },
  { field: "operationId", value: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
  { field: "nonce", value: b64url(Buffer.from(Array.from({ length: 16 }, (_, i) => 1 + i))) },
  { field: "timestamp", value: 1763000001 },
];

// False pairs: two semantically distinct writes that must never share bytes.
const falsePairs = [
  {
    name: "device_binding",
    field: "deviceId",
    a: "dev-01",
    b: "dev-02",
    reason: "a captured signature must not replay under another session_device_id",
  },
  {
    name: "parent_binding",
    field: "parentId",
    a: "",
    b: "dev-01",
    reason: "envelope/credential writes must bind the parent device",
  },
  {
    name: "resource_binding",
    field: "resourceId",
    a: "cred:01",
    b: "cred:02",
    reason: "resource id is the write target",
  },
];

const serverRequirements = [
  "signed deviceId must equal the validated session X-Device-Id / session_device_id before the first receipt acceptance",
  "envelope PUT: resourceType=credential, resourceId=credentialId, parentId=deviceId, all compared exactly to the decoded path",
  "payloadDigest covers the raw body bytes exactly as received; no re-serialization",
  "the encoder decides no route authorization; the server enforces route policy",
];

// JSON-number parity cases: raw JSON text, because `1.0` cannot survive
// JSON.stringify. Both languages must accept integral values and reject
// fractional ones, identically.
const numericCases = [
  { name: "base_revision_1_0", json_value: "1.0", accepted: true, expected_value: 1 },
  { name: "base_revision_1e3", json_value: "1e3", accepted: true, expected_value: 1000 },
  { name: "base_revision_1_5", json_value: "1.5", accepted: false, code: "write_request_uint32_invalid" },
  { name: "base_revision_overflow_float", json_value: "4294967296.0", accepted: false, code: "write_request_uint32_invalid" },
  { name: "base_revision_null", json_value: "null", accepted: false, code: "write_request_type_invalid" },
  { name: "base_revision_true", json_value: "true", accepted: false, code: "write_request_type_invalid" },
];

const numericWire = wire({ hasManifest: 0, manifestDigest: "" });
const numericBytes = preimage({
  ...baseFields({
    route: ROUTES.device,
    resourceType: "device",
    resourceId: "dev-01",
    baseRevision: 1,
    resultRevision: 1,
  }),
  payloadDigest: sha256(Buffer.from("{}")),
});

const fixture = {
  schema: "4allpass-write-request-vectors-v2",
  schema_revision: SCHEMA_REVISION,
  draft_layout_revision: DRAFT_LAYOUT_REVISION,
  protocol_label: LABEL,
  generated_by: "packages/crypto/test/fixtures/generate-write-request-vectors.mjs",
  provenance:
    "Second, spec-only implementation (own u32/frame code, node:crypto Ed25519). No import of src/ or backend/. Signatures are deterministic values anchored by the RFC 8032 vectors.",
  spec: "SIGNED-WRITE-CONTRACT-v2 §1 + V3-ERRATUM-2 (device binding), Draft Layout Rev2",
  routes: ROUTES,
  next_public_key_digest: {
    label: PUBLIC_KEY_LABEL,
    next_public_key: [...NEXT_KEY],
    digest_hex: hex(nextKeyDigest),
  },
  server_requirements: serverRequirements,
  rfc8032: RFC8032.map((vector) => ({
    name: vector.name,
    secret_key: [...Buffer.from(vector.secret_key_hex, "hex")],
    public_key: [...Buffer.from(vector.public_key_hex, "hex")],
    message_hex: vector.message_hex,
    signature_hex: vector.signature_hex,
  })),
  valid: validVectors,
  invalid: invalidVectors,
  tamper_base: tamperBase,
  tamper_cases: tamperCases,
  false_pairs: falsePairs,
  numeric_cases: numericCases,
  numeric_base_wire: numericWire,
  numeric_base_preimage_hex: hex(numericBytes),
};

const out = join(dirname(fileURLToPath(import.meta.url)), "write-request-vectors.json");
writeFileSync(out, JSON.stringify(fixture, null, 2) + "\n", "utf8");
console.log(`wrote ${out} (${validVectors.length} valid, ${invalidVectors.length} invalid, ${tamperCases.length} tamper, ${falsePairs.length} pairs)`);
