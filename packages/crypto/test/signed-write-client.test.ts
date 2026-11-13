import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { webcrypto } from "node:crypto";
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
    const receipt = {
      schema: "4allpass-write-receipt-v1",
      operationId: "0b9d2b7e-5a41-4c8f-8f0e-6d1c2a3b4c5d",
      bodyAvailable: false,
      replayable: true,
      outcome: { status: 200, code: "ok" },
      result: {
        manifestDigest: "a".repeat(64), resourceState: "active", revision: 1, vaultKeyVersion: 1,
      },
      responseDigest: "b19024b75c64af8909d19f9b5195bbf3dc2533ba50c2d4201a80b44ef556f301",
      createdAt: "2026-11-13T00:00:00+00:00",
    };
    const expected = {
      operationId: receipt.operationId,
      vaultId: "6f0c1c1a-3f4e-4c1d-9a7e-2b8d0f5a1c33",
      route: "/api/v1/vaults/{vaultId}/snapshots",
      resourceType: "vault",
      resourceId: "",
      parentId: "",
    };
    const bound = { ...receipt, vaultId: expected.vaultId, route: expected.route, resource: { type: "vault", id: "", parentId: "" } };
    assert.equal(classifySignedWriteResponse(200, h, bound, expected).kind, "replayed");
    assert.equal(classifySignedWriteResponse(200, h, receipt, expected).kind, "unknown");
    assert.equal(classifySignedWriteResponse(200, h, bound).kind, "unknown");
    assert.deepEqual(classifySignedWriteResponse(403, new Headers(), { detail: "device_revoked" }), {
      kind: "rejected",
      status: 403,
      code: "device_revoked",
    });
    assert.equal(classifySignedWriteResponse(502, new Headers(), {}).kind, "unknown");
  });
});


describe("v2 client signer fail-closed checks", () => {
  it("reports unavailable for missing/import/sign/verify failures", async () => {
    assert.deepEqual(await probeSigner({ subtle: null }), {
      available: false,
      reason: "no SubtleCrypto",
    });
    const importFail = {
      importKey: async () => { throw new Error("not supported"); },
      sign: async () => new Uint8Array(),
      verify: async () => true,
    } as unknown as webcrypto.SubtleCrypto;
    assert.equal((await probeSigner({ subtle: importFail })).available, false);

    const signWrong = {
      importKey: async () => ({} as webcrypto.CryptoKey),
      sign: async () => new Uint8Array(64),
      verify: async () => true,
    } as unknown as webcrypto.SubtleCrypto;
    assert.equal((await probeSigner({ subtle: signWrong })).available, false);

    const verifyFail = {
      importKey: async () => ({} as webcrypto.CryptoKey),
      sign: async () => Uint8Array.from(Buffer.from(
        "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b", "hex")),
      verify: async () => false,
    } as unknown as webcrypto.SubtleCrypto;
    assert.equal((await probeSigner({ subtle: verifyFail })).available, false);
  });

  it("rejects next-key presence and digest mismatches", async () => {
    const vector = fixture.valid[0]!;
    const wire = vector.wire;
    const seed = Uint8Array.from(fixture.rfc8032[0]!.secret_key);
    const publicKey = Uint8Array.from(fixture.rfc8032[0]!.public_key);
    const base = {
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
      hasNextKey: false,
      nextPublicKeyDigest: new Uint8Array(0),
      operationId: wire.operationId as string,
      nonce: Uint8Array.from(Buffer.from(wire.nonce as string, "base64url")),
      timestamp: wire.timestamp as number,
    };
    await assert.rejects(
      signWriteV2({ ...base, hasNextKey: true }, { seed, publicKey }),
      /hasNextKey and next key must agree/,
    );
    await assert.rejects(
      signWriteV2(base, { seed, publicKey }, { seed, publicKey }),
      /hasNextKey and next key must agree/,
    );
    await assert.rejects(
      signWriteV2(
        { ...base, hasNextKey: true, nextPublicKeyDigest: new Uint8Array(32) },
        { seed, publicKey },
        { seed, publicKey },
      ),
      /nextPublicKeyDigest does not match/,
    );
  });

  it("does not treat an error status with a replay header as success", () => {
    const replay = new Headers({ "X-4AP-Write-Replayed": "true" });
    assert.deepEqual(classifySignedWriteResponse(500, replay, {}), {
      kind: "unknown",
      reason: "replay_header_on_error",
    });
    assert.deepEqual(classifySignedWriteResponse(200, replay, {}), {
      kind: "unknown",
      reason: "missing_receipt_expectation",
    });
    assert.deepEqual(
      classifySignedWriteResponse(200, replay, {}, {
        operationId: "x", vaultId: "v", route: "r", resourceType: "vault", resourceId: "", parentId: "",
      }),
      { kind: "unknown", reason: "invalid_replay_receipt" },
    );
    const receipt = {
      schema: "4allpass-write-receipt-v1",
      operationId: "0b9d2b7e-5a41-4c8f-8f0e-6d1c2a3b4c5d",
      bodyAvailable: false,
      replayable: true,
      outcome: { status: 200, code: "ok" },
      result: {
        manifestDigest: "a".repeat(64), resourceState: "active", revision: 1, vaultKeyVersion: 1,
      },
      responseDigest: "b19024b75c64af8909d19f9b5195bbf3dc2533ba50c2d4201a80b44ef556f301",
      createdAt: "2026-11-13T00:00:00+00:00",
    };
    const expected2 = {
      operationId: receipt.operationId,
      vaultId: "6f0c1c1a-3f4e-4c1d-9a7e-2b8d0f5a1c33",
      route: "/api/v1/vaults/{vaultId}/snapshots",
      resourceType: "vault",
      resourceId: "",
      parentId: "",
    };
    const bound2 = { ...receipt, vaultId: expected2.vaultId, route: expected2.route, resource: { type: "vault", id: "", parentId: "" } };
    assert.equal(classifySignedWriteResponse(200, replay, bound2, expected2).kind, "replayed");
  });
});
