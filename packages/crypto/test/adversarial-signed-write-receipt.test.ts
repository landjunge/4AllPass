import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { classifySignedWriteResponse } from "../src/index.ts";
import { canonicalReceiptJsonString } from "../src/signed-write-client.ts";

describe("signed-write replay receipt digest", () => {
  const vectors = JSON.parse(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "fixtures", "write-receipt-vectors.json"), "utf8",
  )) as {
    routes: Array<{
      route: string;
      resourceType: string;
      resourceId: string;
      parentId: string;
      result: Record<string, unknown>;
      canonical_json: string;
      response_digest: string;
    }>;
    string_vectors: Array<{ value: string; canonical_json: string; utf8_hex: string }>;
    unsupported_values: string[];
  };
  const header = new Headers({ "X-4AP-Write-Replayed": "true" });
  const operationId = "0b9d2b7e-5a41-4c8f-8f0e-6d1c2a3b4c5d";
  const vaultId = "6f0c1c1a-3f4e-4c1d-9a7e-2b8d0f5a1c33";
  const stamp = "2026-11-13T00:00:00+00:00";

  function expectation(vector: typeof vectors.routes[number]) {
    return {
      operationId, vaultId, route: vector.route,
      resourceType: vector.resourceType, resourceId: vector.resourceId, parentId: vector.parentId,
    };
  }

  function payload(vector: typeof vectors.routes[number], result = vector.result) {
    return {
      schema: "4allpass-write-receipt-v1", operationId, vaultId, route: vector.route,
      resource: { type: vector.resourceType, id: vector.resourceId, parentId: vector.parentId },
      outcome: { status: 200, code: "ok" }, result, replayable: true, bodyAvailable: false,
      responseDigest: vector.response_digest, createdAt: stamp,
    };
  }

  it("matches shared Python ASCII-JSON vectors and accepts each fixed route result", () => {
    for (const vector of vectors.routes) {
      assert.equal(JSON.stringify(vector.result), vector.canonical_json);
      assert.equal(
        classifySignedWriteResponse(200, header, payload(vector), expectation(vector)).kind,
        "replayed",
        vector.route,
      );
    }
  });

  it("quotes Unicode exactly as Python ensure_ascii and hashes its ASCII UTF-8 bytes", () => {
    for (const vector of vectors.string_vectors) {
      const canonical = canonicalReceiptJsonString(vector.value);
      assert.equal(canonical, vector.canonical_json);
      assert.equal(Buffer.from(canonical, "utf8").toString("hex"), vector.utf8_hex);
    }
  });

  it("fails closed for absent, malformed, or mismatched digests and receipt bindings", () => {
    const vector = vectors.routes[0]!;
    const good = payload(vector);
    const badCases: Array<Record<string, unknown>> = [
      { ...good, responseDigest: undefined },
      { ...good, responseDigest: "A".repeat(64) },
      { ...good, responseDigest: "0".repeat(63) },
      { ...good, responseDigest: "0".repeat(64) },
      { ...good, result: { ...vector.result, revision: 2 } },
      { ...good, replayable: false },
      { ...good, outcome: { status: 201, code: "ok" } },
      { ...good, outcome: { status: 200, code: "different" } },
      { ...good, extra: "unexpected" },
    ];
    for (const candidate of badCases) {
      assert.equal(
        classifySignedWriteResponse(200, header, candidate, expectation(vector)).kind,
        "unknown",
      );
    }
    assert.equal(classifySignedWriteResponse(201, header, good, expectation(vector)).kind, "unknown");
  });

  it("rejects unsupported result kinds and out-of-range integer values", () => {
    const vector = vectors.routes[0]!;
    for (const unsupported of vectors.unsupported_values) {
      const value: unknown = unsupported === "undefined" ? undefined
        : unsupported === "NaN" ? Number.NaN
        : unsupported === "float" ? 1.5
        : unsupported === "boolean" ? true
        : unsupported === "array" ? []
        : unsupported === "map" ? new Map()
        : unsupported === "nested-object" ? { nested: "x" }
        : unsupported === "unicode-state" ? "active😀"
        : "unexpected";
      const key = unsupported === "unicode-state" ? "resourceState"
        : unsupported === "undefined" ? "manifestDigest"
        : "revision";
      const changed = { ...vector.result, [key]: value };
      assert.equal(classifySignedWriteResponse(200, header, payload(vector, changed), expectation(vector)).kind,
        "unknown", unsupported);
    }
    for (const revision of [-1, 0x1_0000_0000, Number.MAX_SAFE_INTEGER + 1]) {
      const changed = { ...vector.result, revision };
      assert.equal(classifySignedWriteResponse(200, header, payload(vector, changed), expectation(vector)).kind,
        "unknown", String(revision));
    }
  });
});
