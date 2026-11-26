import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { api } from "./api.ts";
import { clearTestStorage } from "./test-storage-shim.ts";

const VAULT_ID = "6f0c1c1a-3f4e-4c1d-9a7e-2b8d0f5a1c33";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalCreateVaultV2 = api.createVaultV2;

function createWriteSignerStub() {
  return {
    publicKey: new Uint8Array(32).fill(7),
    async sign() {
      return new Uint8Array(64).fill(9);
    },
    dispose() {},
  };
}

/** Captures the signed snapshot body instead of letting the decoder reject v2. */
function installBodyCapture(captured: Array<Record<string, unknown>>): void {
  api.createVaultV2 = async () => ({ vaultId: VAULT_ID, creationGrant: "one-time-grant" });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (_command: string, args: Record<string, unknown>) => {
          const path = String(args.path);
          if (path.endsWith("/devices")) return { status: 201, body: "{}" };
          const snapshot = JSON.parse(String(args.body)) as Record<string, unknown>;
          captured.push(snapshot);
          return { status: 201, body: JSON.stringify({ ...snapshot, vaultId: VAULT_ID }) };
        },
      },
    },
  });
}

afterEach(() => {
  clearTestStorage();
  api.createVaultV2 = originalCreateVaultV2;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("the v2 bootstrap seals a manifest whose version equals the payload version", async (t) => {
  t.mock.module("./write-signer.ts", { namedExports: { createWriteSigner: createWriteSignerStub } });
  const { createVaultV2 } = await import("./vault-session.ts");
  const captured: Array<Record<string, unknown>> = [];
  installBodyCapture(captured);

  // The shared decoder still refuses protocol v2, so the call is expected to
  // fail later. The sealed manifest must already be correct when it is sent.
  await assert.rejects(
    () => createVaultV2("test-password-strong-enough", "mobile_safe"),
    /cryptoProtocolVersion 2 is not supported/,
  );
  assert.equal(captured.length, 1, "one snapshot commit body was sent");
  const body = captured[0];
  assert.equal(body.cryptoProtocolVersion, 2);
  const manifest = body.sealedManifest as { version: number };
  assert.equal(
    manifest.version,
    body.cryptoProtocolVersion,
    "backend/app/services/snapshots.py rejects a commit when these differ",
  );
});
