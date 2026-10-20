import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { indexedDbDeviceUnlockStore } from "../src/store.ts";
import type { DeviceUnlockRecord, DeviceUnlockStore } from "../src/types.ts";

type Handler = (() => void) | null;
const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");

afterEach(() => {
  if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
  else Reflect.deleteProperty(globalThis, "indexedDB");
});

const record: DeviceUnlockRecord = {
  vaultId: "synthetic-device-vault", deviceId: "synthetic-device-id", rpId: "localhost",
  credentialId: "c3ludGhldGljLWNyZWRlbnRpYWw=", mechanism: "prf",
  deviceKeyVersion: 1, createdAt: "2026-10-20T00:00:00Z",
};

/** Control request and transaction events independently; use no browser database. */
function indexedDbEvents(result: unknown) {
  const calls: string[] = [];
  const request = {
    result, error: null as Error | null,
    onsuccess: null as Handler, onerror: null as Handler,
  };
  const tx = {
    error: null as Error | null,
    oncomplete: null as Handler, onabort: null as Handler, onerror: null as Handler,
    objectStore() {
      return {
        get() { calls.push("get"); return request; },
        put() { calls.push("put"); return request; },
        delete() { calls.push("delete"); return request; },
      };
    },
  };
  const db = {
    transaction(_store: string, mode: string) { calls.push(mode); return tx; },
    close() { calls.push("close"); },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const opening = { result: db, onsuccess: null as Handler };
        queueMicrotask(() => opening.onsuccess?.());
        return opening;
      },
    },
  });
  return { calls, request, tx };
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

async function bounded<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("cache operation did not settle")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const operations: Array<{
  name: string; mode: string; request: string; result: unknown;
  run(cache: DeviceUnlockStore): Promise<unknown>;
}> = [
  {
    name: "save", mode: "readwrite", request: "put", result: undefined,
    run: (cache) => cache.save(record),
  },
  {
    name: "load", mode: "readonly", request: "get", result: record,
    run: (cache) => cache.load(record.vaultId, record.deviceId),
  },
  {
    name: "remove", mode: "readwrite", request: "delete", result: undefined,
    run: (cache) => cache.remove(record.vaultId, record.deviceId),
  },
];

for (const operation of operations) {
  test(`${operation.name}: request success waits for transaction completion`, async () => {
    const events = indexedDbEvents(operation.result);
    let settled = false;
    const pending = operation.run(indexedDbDeviceUnlockStore("synthetic-device-record-store"));
    void pending.then(() => { settled = true; }, () => { settled = true; });
    await nextTurn();
    assert.deepEqual(events.calls, [operation.mode, operation.request]);

    events.request.onsuccess?.();
    await nextTurn();
    assert.equal(settled, false, "request success is not a committed transaction");
    assert.equal(events.calls.includes("close"), false);

    events.tx.oncomplete?.();
    assert.deepEqual(await bounded(pending), operation.result);
    assert.deepEqual(events.calls, [operation.mode, operation.request, "close"]);
  });

  test(`${operation.name}: abort after request success rejects`, async () => {
    const events = indexedDbEvents(operation.result);
    const failure = new Error("synthetic transaction abort");
    const pending = operation.run(indexedDbDeviceUnlockStore("synthetic-device-record-store"));
    const rejected = assert.rejects(bounded(pending), (error) => error === failure);
    await nextTurn();
    events.request.onsuccess?.();
    events.tx.error = failure;
    events.tx.onabort?.();
    await rejected;
    assert.equal(events.calls.filter((value) => value === "close").length, 1);
  });

  test(`${operation.name}: abort before request success rejects`, async () => {
    const events = indexedDbEvents(operation.result);
    const failure = new Error("synthetic early transaction abort");
    const pending = operation.run(indexedDbDeviceUnlockStore("synthetic-device-record-store"));
    const rejected = assert.rejects(bounded(pending), (error) => error === failure);
    await nextTurn();
    events.tx.error = failure;
    events.tx.onabort?.();
    await rejected;
    assert.equal(events.calls.filter((value) => value === "close").length, 1);
  });

  test(`${operation.name}: abort without a supplied error rejects`, async () => {
    const events = indexedDbEvents(operation.result);
    const pending = operation.run(indexedDbDeviceUnlockStore("synthetic-device-record-store"));
    const rejected = assert.rejects(bounded(pending), /indexedDB transaction aborted/);
    await nextTurn();
    events.request.onsuccess?.();
    events.tx.onabort?.();
    await rejected;
  });

  test(`${operation.name}: request error propagates and closes the database`, async () => {
    const events = indexedDbEvents(operation.result);
    const failure = new Error("synthetic request failure");
    const pending = operation.run(indexedDbDeviceUnlockStore("synthetic-device-record-store"));
    const rejected = assert.rejects(bounded(pending), (error) => error === failure);
    await nextTurn();
    events.request.error = failure;
    events.request.onerror?.();
    await rejected;
    assert.equal(events.calls.filter((value) => value === "close").length, 1);
  });

  test(`${operation.name}: transaction error propagates`, async () => {
    const events = indexedDbEvents(operation.result);
    const failure = new Error("synthetic transaction failure");
    const pending = operation.run(indexedDbDeviceUnlockStore("synthetic-device-record-store"));
    const rejected = assert.rejects(bounded(pending), (error) => error === failure);
    await nextTurn();
    events.tx.error = failure;
    events.tx.onerror?.();
    await rejected;
    assert.equal(events.calls.filter((value) => value === "close").length, 1);
  });
}
