import assert from "node:assert/strict";
import { createPrivateKey, sign as nodeSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  signWriteV2,
  signWriteV2WithSigner,
  webCryptoWriteSigner,
  type SignedWriteFields,
  type WriteSigner,
} from "../src/index.ts";

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "write-request-vectors.json"), "utf8"),
) as {
  valid: Array<{ wire: Record<string, unknown>; signature_hex: string }>;
  rfc8032: Array<{ secret_key: number[]; public_key: number[] }>;
};

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const b64u = (value: unknown) => Uint8Array.from(Buffer.from(value as string, "base64url"));

function fieldsFromWire(wire: Record<string, unknown>): SignedWriteFields {
  return {
    vaultId: wire.vaultId as string,
    deviceId: wire.deviceId as string,
    method: wire.method as string,
    route: wire.route as string,
    resourceType: wire.resourceType as "vault",
    resourceId: wire.resourceId as string,
    parentId: wire.parentId as string,
    baseRevision: wire.baseRevision as number,
    resultRevision: wire.resultRevision as number,
    keyVersion: wire.signingKeyVersion as number,
    resultKeyVersion: wire.resultKeyVersion as number,
    hasManifest: (wire.hasManifest as number) === 1,
    manifestDigest: b64u(wire.manifestDigest),
    payloadDigest: b64u(wire.payloadDigest),
    hasNextKey: (wire.hasNextKey as number) === 1,
    nextPublicKeyDigest: b64u(wire.nextPublicKeyDigest),
    operationId: wire.operationId as string,
    nonce: b64u(wire.nonce),
    timestamp: wire.timestamp as number,
  };
}

const PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
  0x04, 0x22, 0x04, 0x20,
]);

/** A non-WebCrypto backend (Node crypto), mirroring the native Tauri signer. */
function nodeWriteSigner(seed: Uint8Array, publicKey: Uint8Array): WriteSigner {
  const der = Buffer.concat([Buffer.from(PKCS8_PREFIX), Buffer.from(seed)]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return {
    publicKey,
    sign: async (canonical) => Uint8Array.from(nodeSign(null, Buffer.from(canonical), key)),
  };
}

describe("v2 signer backend abstraction", () => {
  const wire = fixture.valid[0]!.wire;
  const fields = fieldsFromWire(wire);
  const seed = Uint8Array.from(fixture.rfc8032[0]!.secret_key);
  const publicKey = Uint8Array.from(fixture.rfc8032[0]!.public_key);
  const expected = fixture.valid[0]!.signature_hex;

  it("WebCrypto backend matches the shared vector", async () => {
    const signer = await webCryptoWriteSigner({ seed, publicKey });
    const bundle = await signWriteV2WithSigner(fields, signer);
    assert.equal(hex(bundle.signature), expected);
    assert.equal(hex(signer.publicKey), hex(publicKey));
  });

  it("a non-WebCrypto (native-like) backend produces the identical signature", async () => {
    const bundle = await signWriteV2WithSigner(fields, nodeWriteSigner(seed, publicKey));
    assert.equal(hex(bundle.signature), expected);
  });

  it("signWriteV2 wrapper and explicit backend agree byte-for-byte", async () => {
    const viaWrapper = await signWriteV2(fields, { seed, publicKey });
    const viaBackend = await signWriteV2WithSigner(fields, nodeWriteSigner(seed, publicKey));
    assert.equal(hex(viaWrapper.canonical), hex(viaBackend.canonical));
    assert.equal(hex(viaWrapper.signature), hex(viaBackend.signature));
    assert.deepEqual(viaWrapper.headers, viaBackend.headers);
  });
});
