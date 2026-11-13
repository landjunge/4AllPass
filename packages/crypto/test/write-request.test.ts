import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  WRITE_V2_DRAFT_LAYOUT_REVISION,
  WRITE_V2_LABEL,
  WriteRequestV2Error,
  bytesToHex,
  parseWriteRequestV2Wire,
  writePayloadDigestV2,
  writePublicKeyDigestV2,
  writeRequestBytesV2,
  writeRequestV2Hex,
} from "../src/index.ts";

interface Fixture {
  protocol_label: string;
  rfc8032: Array<{
    name: string;
    secret_key: number[];
    public_key: number[];
    message_hex: string;
    signature_hex: string;
  }>;
  next_public_key_digest: { label: string; next_public_key: number[]; digest_hex: string };
  valid: Array<{
    name: string;
    wire: Record<string, unknown>;
    body_b64url: string;
    payload_digest_hex: string;
    preimage_hex: string;
    sha256_hex: string;
    signature_hex: string;
  }>;
  invalid: Array<{ name: string; wire: Record<string, unknown>; code: string }>;
  numeric_cases: Array<{
    name: string;
    json_value: string;
    accepted: boolean;
    expected_value?: number;
    code?: string;
  }>;
  numeric_base_wire: Record<string, unknown>;
  numeric_base_preimage_hex: string;
  draft_layout_revision: number;
  schema_revision: number;
  server_requirements: string[];
  tamper_base: Record<string, unknown>;
  tamper_cases: Array<{ field: string; value: unknown }>;
  false_pairs: Array<{ name: string; field: string; a: unknown; b: unknown }>;
}

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "write-request-vectors.json"), "utf8"),
) as Fixture;

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const privateKeyFromSeed = (seed: number[]) =>
  createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });

const sha256Hex = (bytes: Uint8Array) =>
  createHash("sha256").update(Buffer.from(bytes)).digest("hex");

function publicKeyRaw(seed: number[]): Buffer {
  const spki = createPublicKey(privateKeyFromSeed(seed)).export({ format: "der", type: "spki" });
  return Buffer.from(spki).subarray(-32);
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof WriteRequestV2Error, `expected WriteRequestV2Error, got ${String(error)}`);
    return error.code;
  }
  assert.fail("expected the call to throw");
}

const encodeWire = (wire: Record<string, unknown>): Uint8Array =>
  writeRequestBytesV2(parseWriteRequestV2Wire(wire));

describe("canonical v2 signed WriteRequest", () => {
  it("uses the contract label and field order (not a local invention)", () => {
    assert.equal(WRITE_V2_LABEL, "4allpass-vault-write-v2");
    assert.equal(fixture.protocol_label, WRITE_V2_LABEL);
    const bytes = encodeWire(fixture.valid[0]!.wire);
    assert.equal(bytesToHex(bytes.slice(0, 4)), "00000017");
    assert.equal(bytesToHex(bytes.slice(4, 27)), Buffer.from(WRITE_V2_LABEL, "utf8").toString("hex"));
    assert.equal(WRITE_V2_DRAFT_LAYOUT_REVISION, 2);
    assert.equal(fixture.draft_layout_revision, 2);
    assert.equal(fixture.schema_revision, 2);
  });

  it("places deviceId directly after vaultId (Draft Rev2)", () => {
    const wire = fixture.valid[0]!.wire;
    const bytes = Buffer.from(encodeWire(wire));
    const offset = 4 + Buffer.byteLength(WRITE_V2_LABEL) + 4 + Buffer.byteLength(wire.vaultId as string);
    const deviceId = wire.deviceId as string;
    assert.equal(bytes.readUInt32BE(offset), Buffer.byteLength(deviceId));
    assert.equal(bytes.subarray(offset + 4, offset + 4 + Buffer.byteLength(deviceId)).toString("utf8"), deviceId);
  });

  it("changes bytes for every single-field tamper and never collapses a false pair", () => {
    const base = bytesToHex(encodeWire(fixture.tamper_base));
    for (const testCase of fixture.tamper_cases) {
      const tampered = bytesToHex(encodeWire({ ...fixture.tamper_base, [testCase.field]: testCase.value }));
      assert.notEqual(tampered, base, `tamper not bound: ${testCase.field}`);
    }
    for (const pair of fixture.false_pairs) {
      const a = bytesToHex(encodeWire({ ...fixture.tamper_base, [pair.field]: pair.a }));
      const b = bytesToHex(encodeWire({ ...fixture.tamper_base, [pair.field]: pair.b }));
      assert.notEqual(a, b, `false pair collapsed: ${pair.name}`);
    }
    assert.equal(fixture.server_requirements.length, 4);
    assert.ok(fixture.server_requirements.some((entry) => entry.includes("X-Device-Id")));
  });

  it("reproduces every fixed preimage, digest and signature", () => {
    for (const vector of fixture.valid) {
      const bytes = encodeWire(vector.wire);
      assert.equal(bytesToHex(bytes), vector.preimage_hex, vector.name);
      assert.equal(writeRequestV2Hex(parseWriteRequestV2Wire(vector.wire)), vector.preimage_hex);
      assert.equal(sha256Hex(bytes), vector.sha256_hex, vector.name);
      const key = privateKeyFromSeed(fixture.rfc8032[0]!.secret_key);
      assert.equal(sign(null, Buffer.from(bytes), key).toString("hex"), vector.signature_hex, vector.name);
      assert.equal(
        verify(null, Buffer.from(bytes), createPublicKey(key), Buffer.from(vector.signature_hex, "hex")),
        true,
        vector.name,
      );
    }
  });

  it("hashes the exact raw body and the next public key as specified", () => {
    for (const vector of fixture.valid) {
      const body = Buffer.from(vector.body_b64url, "base64url");
      assert.equal(bytesToHex(writePayloadDigestV2(body)), vector.payload_digest_hex, vector.name);
    }
    const a = new TextEncoder().encode('{"entries":[]}');
    const b = new TextEncoder().encode('{"entries":[]}\n');
    assert.notEqual(bytesToHex(writePayloadDigestV2(a)), bytesToHex(writePayloadDigestV2(b)));
    const nextKey = Buffer.from(fixture.next_public_key_digest.next_public_key);
    assert.equal(bytesToHex(writePublicKeyDigestV2(nextKey)), fixture.next_public_key_digest.digest_hex);
  });

  it("preserves Unicode identity and the 128-character bound", () => {
    const nfc = fixture.valid.find((v) => v.name === "credential_post_nfc")!;
    const nfd = fixture.valid.find((v) => v.name === "credential_post_nfd")!;
    assert.notEqual(nfc.preimage_hex, nfd.preimage_hex);
    const emoji = fixture.valid.find((v) => v.name === "device_post_128_emoji")!;
    const id = emoji.wire.resourceId as string;
    assert.equal([...id].length, 128);
    assert.equal(Buffer.from(id, "utf8").length, 512);
    assert.ok(emoji.preimage_hex.includes(Buffer.from(id, "utf8").toString("hex")));
  });

  it("keeps JSON-number semantics identical to Python (1.0 yes, 1.5 no)", () => {
    const base = JSON.stringify(fixture.numeric_base_wire);
    for (const testCase of fixture.numeric_cases) {
      const text = base.replace(/"baseRevision":\d+/, `"baseRevision":${testCase.json_value}`);
      const wire = JSON.parse(text) as Record<string, unknown>;
      if (testCase.accepted) {
        const parsed = parseWriteRequestV2Wire(wire);
        assert.equal(parsed.baseRevision, testCase.expected_value, testCase.name);
        if (testCase.expected_value === 1) {
          assert.equal(bytesToHex(writeRequestBytesV2(parsed)), fixture.numeric_base_preimage_hex, testCase.name);
        }
      } else {
        assert.equal(codeOf(() => encodeWire(wire)), testCase.code, testCase.name);
      }
    }
  });

  it("rejects every negative fixture with the expected stable code", () => {
    for (const vector of fixture.invalid) {
      assert.equal(codeOf(() => encodeWire(vector.wire)), vector.code, vector.name);
    }
  });

  it("requires canonical lowercase UUIDs at the wire boundary", () => {
    const valid = fixture.valid[0]!.wire;
    assert.equal((valid.vaultId as string).toLowerCase(), valid.vaultId);
    const bad = [
      { ...valid, vaultId: (valid.vaultId as string).toUpperCase() },
      { ...valid, vaultId: `{${valid.vaultId as string}}` },
      { ...valid, operationId: `urn:uuid:${valid.operationId as string}` },
      { ...valid, operationId: (valid.operationId as string).slice(0, 35) },
    ];
    for (const wire of bad) {
      assert.equal(codeOf(() => encodeWire(wire)), "write_request_uuid_invalid");
    }
  });

  it("rejects trailing line terminators on strict fields, keeps opaque ids exact", () => {
    const names = fixture.invalid
      .filter((vector) => /_(lf|cr|crlf|line_separator|paragraph_separator)$/.test(vector.name))
      .map((vector) => vector.name);
    assert.equal(names.length, 20);
    const opaque = fixture.valid.find((vector) => vector.name === "device_id_trailing_lf");
    assert.ok(opaque);
    assert.equal((opaque.wire.deviceId as string).endsWith("\n"), true);
    assert.ok(opaque.preimage_hex.includes(Buffer.from("dev-01\n", "utf8").toString("hex")));
  });

  it("anchors Ed25519 to RFC 8032", () => {
    for (const vector of fixture.rfc8032) {
      const key = privateKeyFromSeed(vector.secret_key);
      const message = Buffer.from(vector.message_hex, "hex");
      assert.equal(Buffer.from(publicKeyRaw(vector.secret_key)).toString("hex"), Buffer.from(vector.public_key).toString("hex"));
      assert.equal(sign(null, message, key).toString("hex"), vector.signature_hex, vector.name);
      assert.equal(
        verify(null, message, createPublicKey(key), Buffer.from(vector.signature_hex, "hex")),
        true,
        vector.name,
      );
    }
  });
});
