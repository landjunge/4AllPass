import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ApiError,
  SidecarRequestError,
  api,
  classifySidecarRequestError,
  classifySidecarTransportRejection,
  getToken,
} from "./api.ts";
import {
  OfflineTransportError,
  isOfflineError,
  setSnapshotCacheForTests,
  type SnapshotCache,
} from "./snapshot-cache.ts";
import { clearTestStorage } from "./test-storage-shim.ts";

type Invoke = (cmd: string, args?: Record<string, unknown>, options?: unknown) => Promise<unknown>;

function installTauri(invoke: Invoke): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_INTERNALS__: { invoke } },
  });
}

function cacheSpy(): { calls: Record<string, number>; cache: SnapshotCache } {
  const calls = {
    load: 0,
    save: 0,
    remove: 0,
    loadLegacy: 0,
    saveLegacy: 0,
    removeLegacy: 0,
  };
  const cache: SnapshotCache = {
    load: async () => {
      calls.load += 1;
      return null;
    },
    save: async () => {
      calls.save += 1;
    },
    remove: async () => {
      calls.remove += 1;
    },
    loadLegacyBackup: async () => {
      calls.loadLegacy += 1;
      return null;
    },
    saveLegacyBackup: async () => {
      calls.saveLegacy += 1;
    },
    removeLegacyBackup: async () => {
      calls.removeLegacy += 1;
    },
  };
  return { calls, cache };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
  setSnapshotCacheForTests(null);
  clearTestStorage();
});

test("only the three typed local transport codes become offline", () => {
  for (const code of ["offline_network", "offline_timeout", "offline_io"] as const) {
    const error = classifySidecarTransportRejection({ code, message: "synthetic" });
    assert.ok(error instanceof OfflineTransportError);
    assert.equal(error?.code, code);
    assert.equal(isOfflineError(error), true);
    assert.equal(error?.message, "desktop sidecar transport unavailable");
  }
});

test("validation, protocol, capability and internal stay non-offline", () => {
  for (const code of ["validation", "protocol", "capability", "internal"] as const) {
    assert.equal(classifySidecarTransportRejection({ code }), null);
    const error = classifySidecarRequestError({ code });
    assert.equal(error.code, code);
    assert.equal(isOfflineError(error), false);
  }
});

test("browser fetch TypeError stays offline; strings and plain errors do not", () => {
  assert.equal(isOfflineError(new TypeError("synthetic fetch failure")), true);
  assert.equal(isOfflineError(new Error("synthetic product error")), false);
  assert.equal(isOfflineError("synthetic string rejection"), false);
  assert.equal(classifySidecarTransportRejection("synthetic string rejection"), null);
  assert.equal(classifySidecarRequestError("synthetic string rejection").code, "capability");
});

test("malformed error objects never become offline", () => {
  for (const value of [null, undefined, {}, { code: 42 }, { code: "offline_unknown" }]) {
    assert.equal(classifySidecarTransportRejection(value), null);
    assert.equal(classifySidecarRequestError(value).code, "capability");
  }
});

test("Tauri request route keeps 401/403/409/422 as ApiError and does not touch auth/cache", async () => {
  const { calls, cache } = cacheSpy();
  setSnapshotCacheForTests(cache);
  for (const status of [401, 403, 409, 422]) {
    installTauri(async () => ({
      status,
      body: JSON.stringify({ detail: "synthetic status body" }),
    }));
    await assert.rejects(
      () => api.listVaults(),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, status);
        assert.equal(isOfflineError(error), false);
        return true;
      },
    );
    assert.equal(getToken(), null);
  }
  assert.deepEqual(calls, {
    load: 0,
    save: 0,
    remove: 0,
    loadLegacy: 0,
    saveLegacy: 0,
    removeLegacy: 0,
  });
});

test("Tauri request route maps only typed offline rejection and keeps the cache untouched", async () => {
  const { calls, cache } = cacheSpy();
  setSnapshotCacheForTests(cache);
  installTauri(async () => {
    throw { code: "offline_network", message: "desktop sidecar network unavailable" };
  });
  await assert.rejects(
    () => api.listVaults(),
    (error: unknown) => {
      assert.ok(error instanceof OfflineTransportError);
      assert.equal(error.code, "offline_network");
      assert.equal(isOfflineError(error), true);
      return true;
    },
  );
  assert.equal(getToken(), null);
  assert.deepEqual(calls, {
    load: 0,
    save: 0,
    remove: 0,
    loadLegacy: 0,
    saveLegacy: 0,
    removeLegacy: 0,
  });
});

test("Tauri request route keeps validation/protocol/capability rejection non-offline", async () => {
  for (const code of ["validation", "protocol"] as const) {
    installTauri(async () => {
      throw { code };
    });
    await assert.rejects(
      () => api.listVaults(),
      (error: unknown) => {
        assert.ok(error instanceof SidecarRequestError);
        assert.equal(error.code, code);
        assert.equal(isOfflineError(error), false);
        return true;
      },
    );
  }
  installTauri(async () => {
    throw "command not allowed";
  });
  await assert.rejects(
    () => api.listVaults(),
    (error: unknown) => {
      assert.ok(error instanceof SidecarRequestError);
      assert.equal(error.code, "capability");
      assert.equal(isOfflineError(error), false);
      return true;
    },
  );
});
