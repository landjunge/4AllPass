import assert from "node:assert/strict";
import { test } from "node:test";

import { isOfflineError, memorySnapshotCache } from "./snapshot-cache.ts";

test("memory cache round-trips a wire snapshot", async () => {
  const cache = memorySnapshotCache();
  const snapshot = {
    vaultId: "vault-offline-1",
    revision: 3,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1,
    envelopes: [],
    entries: [],
  };
  await cache.save("vault-offline-1", snapshot);
  const loaded = await cache.load("vault-offline-1");
  assert.deepEqual(loaded, snapshot);
  await cache.remove("vault-offline-1");
  assert.equal(await cache.load("vault-offline-1"), null);
});

test("refuses to store a snapshot under a different vault id", async () => {
  const cache = memorySnapshotCache();
  await assert.rejects(
    () =>
      cache.save("vault-a", {
        vaultId: "vault-b",
        revision: 1,
        vaultKeyVersion: 1,
        cryptoProtocolVersion: 1,
        envelopes: [],
        entries: [],
      }),
    /vaultId does not match/,
  );
});

test("TypeError is offline; ApiError-shaped HTTP failures are not", () => {
  assert.equal(isOfflineError(new TypeError("Failed to fetch")), true);
  assert.equal(isOfflineError(new Error("Failed to fetch")), false);
});
