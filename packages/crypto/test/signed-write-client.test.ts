import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifySignedWriteResponse,
  probeSigner,
  signWriteV2,
} from "../src/index.ts";

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "write-request-vectors.json"), "utf8"),
) as {
  valid: Array<{ wire: Record<string, unknown>; signature_hex: string; body_b64url: string }>;
  rfc8032: Array<{ secret_key: number[]; public_key: number[] }>;
};

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("v2 client signer", () => {
  it("probes the real runtime and rejects an unavailable signer", async () => {
    const probe = await probeSigner();
    assert.equal(probe.available, true, probe.reason);
  });

  it("signs the shared vector with the RFC 8032 seed", async () => {
    const vector = fixture.valid[0]!;
    const wire = vector.wire;
    const seed = Uint8Array.from(fixture.rfc8032[0]!.secret_key);
    const publicKey = Uint8Array.from(fixture.rfc8032[0]!.public_key);
    const bundle = await signWriteV2(
      {
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
        manifestDigest: Uint8Array.from(Buffer.from(wire.manifestDigest as string, "base64url")),
        payloadDigest: Uint8Array.from(Buffer.from(wire.payloadDigest as string, "base64url")),
        hasNextKey: (wire.hasNextKey as number) === 1,
        nextPublicKeyDigest: Uint8Array.from(Buffer.from(wire.nextPublicKeyDigest as string, "base64url")),
        operationId: wire.operationId as string,
        nonce: Uint8Array.from(Buffer.from(wire.nonce as string, "base64url")),
        timestamp: wire.timestamp as number,
      },
      { seed, publicKey },
    );
    assert.equal(hex(bundle.signature), vector.signature_hex);
  });

  it("classifies replay, rejection and unknown without inventing success", () => {
    const h = new Headers({ "X-4AP-Write-Replayed": "true" });
    assert.equal(classifySignedWriteResponse(200, h, { receipt: true }).kind, "replayed");
    assert.deepEqual(classifySignedWriteResponse(403, new Headers(), { detail: "device_revoked" }), {
      kind: "rejected",
      status: 403,
      code: "device_revoked",
    });
    assert.equal(classifySignedWriteResponse(502, new Headers(), {}).kind, "unknown");
  });
});
