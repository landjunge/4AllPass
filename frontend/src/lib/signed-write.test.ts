import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign as nodeSign } from "node:crypto";
import { afterEach, mock, test } from "node:test";
import {
  deriveWriteSigners,
  performSignedWrite,
  resumeSignedWrite,
  resolveSignedWrite,
  SignedWriteRejectedError,
  SignedWriteUnknownError,
  type SignedWriteCall,
} from "./signed-write.ts";
import { setNativeInvokeForTests, type NativeInvoke } from "./write-signer.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { STORAGE_ORIGIN_KEY } from "./storage-origin.ts";
import { resumeSignedWriteRequest } from "./api.ts";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
let signCalls = 0;
const realNativeMock: NativeInvoke = async (_command, args) => {
  signCalls++;
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
  method: string;
  headers: Record<string, string>;
  body: string;
  path: string;
}
let captured: Captured | null = null;
const capturedRequests: Captured[] = [];
let response: { status: number; body: string; replayed?: boolean } = { status: 200, body: "{}" };
let transportFailure: Error | null = null;

function installTransport(): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string, args: Record<string, unknown>) => {
          assert.equal(cmd, "sidecar_http");
          captured = {
            method: args.method as string,
            headers: args.headers as Record<string, string>,
            body: args.body as string,
            path: args.path as string,
          };
          capturedRequests.push(captured);
          if (transportFailure) throw transportFailure;
          return response;
        },
      },
      location: { origin: "https://app.example.test" },
    },
  });
}

function installFetchTransport(): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "https://app.example.test" } },
  });
  globalThis.fetch = async (input, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const request: Captured = {
      method: init?.method ?? "GET",
      path: String(input),
      headers,
      body: String(init?.body ?? ""),
    };
    captured = request;
    capturedRequests.push(request);
    return {
      status: response.status,
      text: async () => response.body,
      headers: new Headers(response.replayed ? { "X-4AP-Write-Replayed": "true" } : {}),
    } as Response;
  };
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
    result: {
      manifestDigest: "a".repeat(64),
      resourceState: "active",
      revision: 1,
      vaultKeyVersion: 1,
    },
    replayable: true,
    bodyAvailable: false,
    responseDigest: "b19024b75c64af8909d19f9b5195bbf3dc2533ba50c2d4201a80b44ef556f301",
    createdAt: "2026-11-13T00:00:00+00:00",
    ...overrides,
  });
}

afterEach(() => {
  setNativeInvokeForTests(null);
  captured = null;
  capturedRequests.length = 0;
  signCalls = 0;
  transportFailure = null;
  response = { status: 200, body: "{}" };
  clearTestStorage();
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

test("502 stays UNKNOWN without a resumable live-session context", async () => {
  installTransport();
  response = { status: 502, body: "{}" };
  const outcome = await performSignedWrite(baseCall(), await pair());
  assert.equal(outcome.kind, "unknown");
  await assert.rejects(
    () => resolveSignedWrite(outcome, operation, async () => ({})),
    (error: unknown) =>
      error instanceof SignedWriteUnknownError &&
      error.operation.operationId === OP &&
      error.retryContext === undefined,
  );
});

test("first UNKNOWN transport failure retains the exact retry context", async () => {
  installTransport();
  transportFailure = Object.assign(new Error("offline"), { code: "offline_timeout" });
  const outcome = await performSignedWrite(
    baseCall({ assertLive: () => {} }),
    await pair(),
  );
  assert.equal(outcome.kind, "unknown");
  assert.ok(outcome.retryContext);
  await assert.rejects(
    () => resolveSignedWrite(outcome, operation, async () => ({})),
    (error: unknown) =>
      error instanceof SignedWriteUnknownError && error.retryContext === outcome.retryContext,
  );
});

test("failed replay body read retains the exact retry context", async () => {
  installTransport();
  response = { status: 200, replayed: true, body: receipt() };
  const outcome = await performSignedWrite(
    baseCall({ assertLive: () => {} }),
    await pair(),
  );
  assert.equal(outcome.kind, "replayed");
  assert.ok(outcome.retryContext);
  await assert.rejects(
    () => resolveSignedWrite(outcome, operation, async () => { throw new Error("read unavailable"); }),
    (error: unknown) =>
      error instanceof SignedWriteUnknownError && error.retryContext === outcome.retryContext,
  );
});

test("explicit UNKNOWN resume replays the identical signed request without signing", async () => {
  installTransport();
  response = { status: 502, body: "{}" };
  const call = baseCall({ assertLive: () => {} });
  const firstOutcome = await performSignedWrite(call, await pair());
  let unknown: SignedWriteUnknownError | undefined;
  await assert.rejects(
    () => resolveSignedWrite(firstOutcome, operation, async () => ({})),
    (error: unknown) => {
      if (error instanceof SignedWriteUnknownError) unknown = error;
      return error instanceof SignedWriteUnknownError;
    },
  );
  assert.ok(unknown?.retryContext);
  const first = structuredClone(capturedRequests[0]);
  assert.equal(unknown.retryContext.operationId, first.headers["X-4AP-Write-Operation-Id"]);
  assert.equal(unknown.retryContext.nonce, first.headers["X-4AP-Write-Nonce"]);
  assert.equal(
    String(unknown.retryContext.timestamp),
    first.headers["X-4AP-Write-Timestamp"],
  );
  assert.equal(unknown.retryContext.bodyString, first.body);
  const signsBeforeResume = signCalls;

  response = { status: 200, replayed: true, body: receipt() };
  const originalNow = Date.now;
  Date.now = () => originalNow() + 120_000;
  let resumed: Awaited<ReturnType<typeof resumeSignedWrite>>;
  try {
    resumed = await resumeSignedWrite(unknown);
  } finally {
    Date.now = originalNow;
  }
  assert.equal(resumed.kind, "replayed");
  assert.deepEqual(capturedRequests[1], first);
  assert.equal(signCalls, signsBeforeResume);
});

test("resume refuses a changed storage origin without sending", async () => {
  installFetchTransport();
  localStorage.setItem(STORAGE_ORIGIN_KEY, "https://one.example.test");
  response = { status: 502, body: "{}" };
  const firstOutcome = await performSignedWrite(
    baseCall({ assertLive: () => {} }),
    await pair(),
  );
  let unknown: SignedWriteUnknownError | undefined;
  await assert.rejects(() => resolveSignedWrite(firstOutcome, operation, async () => ({})), (error: unknown) => {
    if (error instanceof SignedWriteUnknownError) unknown = error;
    return error instanceof SignedWriteUnknownError;
  });
  localStorage.setItem(STORAGE_ORIGIN_KEY, "https://two.example.test");
  const resumed = await resumeSignedWrite(unknown!);
  assert.equal(resumed.kind, "unknown");
  assert.equal(resumed.reason, "request_target_changed");
  assert.equal(capturedRequests.length, 1);
});

test("resume refuses a changed transport without sending", async () => {
  installTransport();
  response = { status: 502, body: "{}" };
  const firstOutcome = await performSignedWrite(
    baseCall({ assertLive: () => {} }),
    await pair(),
  );
  let unknown: SignedWriteUnknownError | undefined;
  await assert.rejects(() => resolveSignedWrite(firstOutcome, operation, async () => ({})), (error: unknown) => {
    if (error instanceof SignedWriteUnknownError) unknown = error;
    return error instanceof SignedWriteUnknownError;
  });
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  globalThis.fetch = async () => {
    throw new Error("changed transport must not be called");
  };
  const resumed = await resumeSignedWrite(unknown!);
  assert.equal(resumed.kind, "unknown");
  assert.equal(resumed.reason, "request_target_changed");
  assert.equal(capturedRequests.length, 1);
});

test("target change during async signing is rejected before the first fetch", async () => {
  installFetchTransport();
  localStorage.setItem(STORAGE_ORIGIN_KEY, "https://one.example.test");
  let beginSigning!: () => void;
  let finishSigning!: () => void;
  const signingStarted = new Promise<void>((resolve) => { beginSigning = resolve; });
  const signingGate = new Promise<void>((resolve) => { finishSigning = resolve; });
  const pending = performSignedWrite(baseCall({ assertLive: () => {} }), {
    signer: {
      publicKey: new Uint8Array(32).fill(7),
      sign: async () => {
        beginSigning();
        await signingGate;
        return new Uint8Array(64).fill(9);
      },
    },
  });

  await signingStarted;
  localStorage.setItem(STORAGE_ORIGIN_KEY, "https://two.example.test");
  finishSigning();
  const outcome = await pending;
  assert.equal(outcome.kind, "unknown");
  if (outcome.kind === "unknown") assert.equal(outcome.reason, "request_target_changed");
  assert.equal(capturedRequests.length, 0);
});

test("target change after signing is rejected at the first-send boundary", async () => {
  installFetchTransport();
  localStorage.setItem(STORAGE_ORIGIN_KEY, "https://one.example.test");
  let liveChecks = 0;
  const outcome = await performSignedWrite(
    baseCall({
      assertLive: () => {
        liveChecks += 1;
        if (liveChecks === 2) localStorage.setItem(STORAGE_ORIGIN_KEY, "https://two.example.test");
      },
    }),
    {
      signer: {
        publicKey: new Uint8Array(32).fill(7),
        sign: async () => new Uint8Array(64).fill(9),
      },
    },
  );

  assert.equal(outcome.kind, "unknown");
  if (outcome.kind === "unknown") assert.equal(outcome.reason, "request_target_changed");
  assert.equal(capturedRequests.length, 0);
});

const moduleMockAvailable = typeof (mock as { module?: unknown }).module === "function";
test(
  "target change while sidecar invoke module loads is rejected with zero IPC sends",
  { skip: !moduleMockAvailable },
  async (t) => {
    let invokes = 0;
    t.mock.module("@tauri-apps/api/core", {
      namedExports: {
        invoke: async () => {
          invokes += 1;
          return { status: 502, body: "{}" };
        },
      },
    });
    installTransport();
    const pending = resumeSignedWriteRequest({
      method: "POST",
      path: `/vaults/${VAULT}/snapshots`,
      bodyString: "{}",
      headers: {},
      deviceId: "dev_test_0001",
      expected: {
        operationId: OP,
        vaultId: VAULT,
        route: ROUTE,
        resourceType: "vault",
        resourceId: "",
        parentId: "",
      },
      target: Object.freeze({ transport: "sidecar", origin: "http://127.0.0.1:8788/api/v1" }),
    });
    queueMicrotask(() => localStorage.setItem(STORAGE_ORIGIN_KEY, "https://two.example.test"));

    const outcome = await pending;
    assert.deepEqual(outcome, { kind: "unknown", reason: "request_target_changed" });
    assert.equal(invokes, 0);
  },
);

test("invalid altered-body retry context stays UNKNOWN and is never sent", async () => {
  installTransport();
  response = { status: 502, body: "{}" };
  const firstOutcome = await performSignedWrite(
    baseCall({ assertLive: () => {} }),
    await pair(),
  );
  let unknown: SignedWriteUnknownError | undefined;
  await assert.rejects(
    () => resolveSignedWrite(firstOutcome, operation, async () => ({})),
    (error: unknown) => {
      if (error instanceof SignedWriteUnknownError) unknown = error;
      return error instanceof SignedWriteUnknownError;
    },
  );
  assert.ok(unknown?.retryContext);
  const altered = Object.freeze({ ...unknown.retryContext, bodyString: '{"revision":2}' });
  Object.defineProperty(unknown, "retryContext", { value: altered });

  const resumed = await resumeSignedWrite(unknown);
  assert.equal(resumed.kind, "unknown");
  assert.equal(capturedRequests.length, 1);
});

test("missing UNKNOWN request context stays UNKNOWN without a transport call", async () => {
  const resumed = await resumeSignedWrite(new SignedWriteUnknownError("old_unknown", operation));
  assert.equal(resumed.kind, "unknown");
  assert.equal(resumed.reason, "retry_context_missing_or_invalid");
  assert.equal(capturedRequests.length, 0);
});

test("changed vault generation refuses explicit UNKNOWN resume", async () => {
  installTransport();
  response = { status: 502, body: "{}" };
  let live = true;
  const firstOutcome = await performSignedWrite(
    baseCall({ assertLive: () => assert.equal(live, true) }),
    await pair(),
  );
  let unknown: SignedWriteUnknownError | undefined;
  await assert.rejects(
    () => resolveSignedWrite(firstOutcome, operation, async () => ({})),
    (error: unknown) => {
      if (error instanceof SignedWriteUnknownError) unknown = error;
      return error instanceof SignedWriteUnknownError;
    },
  );
  assert.ok(unknown?.retryContext);
  live = false;

  const resumed = await resumeSignedWrite(unknown);
  assert.equal(resumed.kind, "unknown");
  assert.equal(resumed.reason, "vault_session_changed");
  assert.equal(capturedRequests.length, 1);
});

test("creation grant header is attached to the signed request", async () => {
  installTransport();
  response = { status: 200, body: "{}" };
  await performSignedWrite(baseCall({ creationGrant: "grant-123" }), await pair());
  assert.equal(captured!.headers["X-4AP-Creation-Grant"], "grant-123");
});
