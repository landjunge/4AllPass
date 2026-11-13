import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign as nodeSign } from "node:crypto";
import { afterEach, test } from "node:test";
import {
  deriveWriteSigners,
  performSignedWrite,
  resolveSignedWrite,
  SignedWriteRejectedError,
  SignedWriteUnknownError,
  type SignedWriteCall,
} from "./signed-write.ts";
import { setNativeInvokeForTests, type NativeInvoke } from "./write-signer.ts";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const realNativeMock: NativeInvoke = async (_command, args) => {
  const seed = Buffer.from(args.seed as number[]);
  const message = Buffer.from(args.message as number[]);
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(key).export({ type: "spki", format: "der" }).subarray(-32);
  return { publicKey: Array.from(publicKey), signature: Array.from(nodeSign(null, message, key)) };
};

const VAULT = "6f0c1c1a-3f4e-4c1d-9a7e-2b8d0f5a1c33";
const OP = "0b9d2b7e-5a41-4c8f-8f0e-6d1c2a3b4c5d";
const ROUTE = "/api/v1/vaults/{vaultId}/snapshots";
const operation = { operationId: OP, nonce: Uint8Array.from({ length: 16 }, (_, i) => i) };

interface Captured {
  headers: Record<string, string>;
  body: string;
  path: string;
}
let captured: Captured | null = null;
let response: { status: number; body: string; replayed?: boolean } = { status: 200, body: "{}" };

function installTransport(): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string, args: Record<string, unknown>) => {
          assert.equal(cmd, "sidecar_http");
          captured = {
            headers: args.headers as Record<string, string>,
            body: args.body as string,
            path: args.path as string,
          };
          return response;
        },
      },
    },
  });
}

function baseCall(overrides: Partial<SignedWriteCall> = {}): SignedWriteCall {
  return {
    method: "POST",
    route: ROUTE,
    path: `/vaults/${VAULT}/snapshots`,
    resourceType: "vault",
    resourceId: "",
    parentId: "",
    baseRevision: 0,
    resultRevision: 1,
    keyVersion: 1,
    resultKeyVersion: 1,
    hasManifest: true,
    manifestDigest: Uint8Array.from({ length: 32 }, () => 0x11),
    bodyString: JSON.stringify({ revision: 1 }),
    vaultId: VAULT,
    deviceId: "dev_test_0001",
    operation,
    ...overrides,
  };
}

function receipt(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: "4allpass-write-receipt-v1",
    operationId: OP,
    vaultId: VAULT,
    route: ROUTE,
    resource: { type: "vault", id: "", parentId: "" },
    outcome: { status: 200, code: "ok" },
    bodyAvailable: false,
    ...overrides,
  });
}

afterEach(() => {
  setNativeInvokeForTests(null);
  captured = null;
  response = { status: 200, body: "{}" };
});

async function pair() {
  setNativeInvokeForTests(realNativeMock);
  return deriveWriteSigners(Uint8Array.from({ length: 32 }, () => 1), VAULT, 1);
}

test("ok outcome returns the committed body and binds the signed headers", async () => {
  installTransport();
  response = { status: 200, body: JSON.stringify({ revision: 1 }) };
  const outcome = await performSignedWrite(baseCall(), await pair());
  const body = await resolveSignedWrite(outcome, operation, async () => ({ fallback: true }));
  assert.deepEqual(body, { revision: 1 });
  assert.equal(captured!.headers["X-4AP-Write-Operation-Id"], OP);
  assert.equal(captured!.headers["X-4AP-Write-Scheme"], "ed25519-v1");
  assert.ok(captured!.headers["X-4AP-Write-Signature"]);
  assert.equal(captured!.path, `/api/v1/vaults/${VAULT}/snapshots`);
});

test("replayed receipt resolves through the read route, not a replayed body", async () => {
  installTransport();
  response = { status: 200, replayed: true, body: receipt() };
  const outcome = await performSignedWrite(baseCall(), await pair());
  assert.equal(outcome.kind, "replayed");
  let readCalled = false;
  const body = await resolveSignedWrite(outcome, operation, async () => {
    readCalled = true;
    return { revision: 1 };
  });
  assert.equal(readCalled, true);
  assert.deepEqual(body, { revision: 1 });
});

test("a receipt bound to a different operation is UNKNOWN, never ok", async () => {
  installTransport();
  response = { status: 200, replayed: true, body: receipt({ operationId: "ffffffff-ffff-ffff-ffff-ffffffffffff" }) };
  const outcome = await performSignedWrite(baseCall(), await pair());
  assert.equal(outcome.kind, "unknown");
  await assert.rejects(
    () => resolveSignedWrite(outcome, operation, async () => ({})),
    SignedWriteUnknownError,
  );
});

test("409 is a typed rejection", async () => {
  installTransport();
  response = { status: 409, body: JSON.stringify({ detail: "write_operation_mismatch" }) };
  const outcome = await performSignedWrite(baseCall(), await pair());
  assert.equal(outcome.kind, "rejected");
  await assert.rejects(
    () => resolveSignedWrite(outcome, operation, async () => ({})),
    (error: unknown) => error instanceof SignedWriteRejectedError && error.status === 409,
  );
});

test("502 stays UNKNOWN and carries the operation for an exact retry", async () => {
  installTransport();
  response = { status: 502, body: "{}" };
  const outcome = await performSignedWrite(baseCall(), await pair());
  assert.equal(outcome.kind, "unknown");
  await assert.rejects(
    () => resolveSignedWrite(outcome, operation, async () => ({})),
    (error: unknown) =>
      error instanceof SignedWriteUnknownError && error.operation.operationId === OP,
  );
});

test("creation grant header is attached and a retry reuses the operation id", async () => {
  installTransport();
  response = { status: 200, body: "{}" };
  await performSignedWrite(baseCall({ creationGrant: "grant-123" }), await pair());
  assert.equal(captured!.headers["X-4AP-Creation-Grant"], "grant-123");
  const firstOp = captured!.headers["X-4AP-Write-Operation-Id"];
  // A retry gets a fresh one-operation signer but reuses the operation id/nonce.
  await performSignedWrite(baseCall(), await pair());
  assert.equal(captured!.headers["X-4AP-Write-Operation-Id"], firstOp);
});
