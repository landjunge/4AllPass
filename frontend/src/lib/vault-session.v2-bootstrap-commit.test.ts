import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { api } from "./api.ts";
import { clearTestStorage } from "./test-storage-shim.ts";

const VAULT_ID = "6f0c1c1a-3f4e-4c1d-9a7e-2b8d0f5a1c33";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalCreateVaultV2 = api.createVaultV2;
let signers: Array<{ signCalls: number; disposeCalls: number; disposed: boolean }> = [];
let httpPaths: string[] = [];
let failBootstrapOperationId = false;
let restoreRandomUUID: (() => void) | null = null;

function failNextRandomUUID(): void {
  const cryptoObject = globalThis.crypto;
  const descriptor = Object.getOwnPropertyDescriptor(cryptoObject, "randomUUID");
  Object.defineProperty(cryptoObject, "randomUUID", {
    configurable: true,
    writable: true,
    value: () => { throw new Error("controlled bootstrap operation-id failure"); },
  });
  restoreRandomUUID = () => {
    if (descriptor) Object.defineProperty(cryptoObject, "randomUUID", descriptor);
    else Reflect.deleteProperty(cryptoObject, "randomUUID");
    restoreRandomUUID = null;
  };
}

async function createWriteSignerSpy() {
  const signer = {
    publicKey: new Uint8Array(32).fill(7),
    signCalls: 0,
    disposeCalls: 0,
    disposed: false,
    async sign() {
      if (this.disposed) throw new Error("disposed signer must never be used");
      this.signCalls += 1;
      return new Uint8Array(64).fill(9);
    },
    dispose() {
      if (!this.disposed) {
        this.disposed = true;
        this.disposeCalls += 1;
      }
    },
  };
  signers.push(signer);
  if (signers.length === 3) {
    assert.ok(
      signers.slice(0, 2).every((item) => item.disposed && item.disposeCalls === 1),
      "bootstrap signers must be disposed before creating the fresh commit signer",
    );
  }
  if (failBootstrapOperationId && signers.length === 2) failNextRandomUUID();
  return signer;
}

function installApiHarness(): void {
  api.createVaultV2 = async () => ({ vaultId: VAULT_ID, creationGrant: "one-time-grant" });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: Record<string, unknown>) => {
          assert.equal(command, "sidecar_http");
          const path = String(args.path);
          httpPaths.push(path);
          if (path.endsWith("/devices")) return { status: 201, body: "{}" };
          assert.ok(path.endsWith("/snapshots"), `unexpected request path ${path}`);
          const snapshot = JSON.parse(String(args.body)) as Record<string, unknown>;
          return { status: 201, body: JSON.stringify({ ...snapshot, vaultId: VAULT_ID }) };
        },
      },
    },
  });
}

afterEach(() => {
  restoreRandomUUID?.();
  clearTestStorage();
  signers = [];
  httpPaths = [];
  failBootstrapOperationId = false;
  api.createVaultV2 = originalCreateVaultV2;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("v2 bootstrap disposes its signers before commit and on pre-send failure", async (t) => {
  t.mock.module("./write-signer.ts", { namedExports: { createWriteSigner: createWriteSignerSpy } });
  const { createVaultV2 } = await import("./vault-session.ts");
  installApiHarness();

  // This integration check is scoped to signer lifetime. The current shared
  // snapshot decoder rejects protocol v2 after the commit response is received;
  // retain that separate result without claiming overall v2 acceptance.
  await assert.rejects(
    () => createVaultV2("test-password-strong-enough", "mobile_safe"),
    /cryptoProtocolVersion 2 is not supported/,
  );
  assert.deepEqual(httpPaths, [
    `/api/v1/vaults/${VAULT_ID}/devices`,
    `/api/v1/vaults/${VAULT_ID}/snapshots`,
  ]);
  assert.equal(signers.length, 3, "bootstrap pair is followed by a fresh commit signer");
  assert.ok(signers.every((signer) => signer.signCalls === 1));
  assert.ok(signers.every((signer) => signer.disposed && signer.disposeCalls === 1));

  // Fail after both bootstrap signers exist but before performSignedWrite can
  // own cleanup. The call-site finally must still dispose both signers.
  signers = [];
  httpPaths = [];
  failBootstrapOperationId = true;
  await assert.rejects(
    () => createVaultV2("test-password-strong-enough", "mobile_safe"),
    /controlled bootstrap operation-id failure/,
  );
  assert.equal(signers.length, 2, "both bootstrap signers were acquired before operation creation");
  assert.ok(signers.every((signer) => signer.disposed && signer.disposeCalls === 1));
  assert.equal(httpPaths.length, 0, "operation creation failure occurs before any HTTP request");
  restoreRandomUUID?.();
});
