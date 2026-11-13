import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign as nodeSign } from "node:crypto";
import { afterEach, test } from "node:test";

import { SignedWriteUnknownError } from "./signed-write.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { setNativeInvokeForTests, type NativeInvoke } from "./write-signer.ts";
import { commitEntries, type UnlockedVault } from "./vault-session.ts";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let requestCount = 0;

const realNativeMock: NativeInvoke = async (command, args) => {
  assert.equal(command, "sign_ed25519_v2");
  const seed = Buffer.from(args.seed as number[]);
  const message = Buffer.from(args.message as number[]);
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(key).export({ type: "spki", format: "der" }).subarray(-32);
  return {
    publicKey: Array.from(publicKey),
    signature: Array.from(nodeSign(null, message, key)),
  };
};

afterEach(() => {
  setNativeInvokeForTests(null);
  clearTestStorage();
  requestCount = 0;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("v2 commit without VaultLiveness is UNKNOWN but cannot be resumed", async () => {
  setNativeInvokeForTests(realNativeMock);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          assert.equal(command, "sidecar_http");
          requestCount++;
          return { status: 502, body: "{}" };
        },
      },
    },
  });
  const vault: UnlockedVault = {
    vaultId: "6f0c1c1a-3f4e-4c1d-9a7e-2b8d0f5a1c33",
    revision: 1,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 2,
    vaultKey: new Uint8Array(32).fill(0x5a),
    envelopes: [],
    entries: [],
    unlockedWith: "recovery_key",
  };

  try {
    await assert.rejects(
      () => commitEntries(vault, []),
      (error: unknown) =>
        error instanceof SignedWriteUnknownError && error.retryContext === undefined,
    );
    assert.equal(requestCount, 1, "the initial write is sent exactly once");
  } finally {
    vault.vaultKey.fill(0);
  }
});
