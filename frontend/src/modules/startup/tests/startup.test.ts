import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import "../../../lib/test-storage-shim.ts";
import {
  clearOfflineBootstrap,
  loadOfflineBootstrap,
  saveOfflineBootstrap,
  type OfflineBootstrapBinding,
} from "../../../lib/offline-bootstrap.ts";
import { OfflineTransportError } from "../../../lib/snapshot-cache.ts";

import {
  runStartup,
  type LocalStoreStatus,
  type StartupDependencies,
  type StartupGateway,
} from "../index.ts";

const localStatus: LocalStoreStatus = {
  hasLocalVault: true,
  localEntries: 2,
  hasOtherAccounts: false,
  localVaultId: "local-vault",
};

const TEST_BINDING: OfflineBootstrapBinding = {
  sessionFingerprint: "a".repeat(64),
  storageOrigin: null,
};
const FOREIGN_BINDING: OfflineBootstrapBinding = {
  sessionFingerprint: "b".repeat(64),
  storageOrigin: null,
};

interface FixtureOptions {
  dependencies?: Partial<Omit<StartupDependencies, "gateway">>;
  gateway?: (events: string[]) => Partial<StartupGateway>;
}

function fixture(options: FixtureOptions = {}) {
  const events: string[] = [];
  const gateway: StartupGateway = {
    async waitForHealth() {
      events.push("health");
      return { profile: "server" };
    },
    async localStatus() {
      events.push("local-status");
      return localStatus;
    },
    async localSession() {
      events.push("local-session");
      return { email: "local@127.0.0.1" };
    },
    async me() {
      events.push("me");
      return { email: "user@example.test" };
    },
    ...options.gateway?.(events),
  };
  const dependencies: StartupDependencies = {
    gateway,
    hasToken: () => false,
    isDesktop: () => false,
    hasStorageOrigin: () => false,
    restoreSession(email) {
      events.push(`session:${email ?? "none"}`);
    },
    async loadVaults() {
      events.push("vaults:load");
      return [];
    },
    restoreOffline(email) {
      events.push(`offline:${email}`);
    },
    async saveOfflineBootstrap(email, vaults) {
      events.push(`bootstrap:${email}`);
      await saveOfflineBootstrap(email, vaults, TEST_BINDING);
    },
    async loadOfflineBootstrap() {
      return loadOfflineBootstrap(TEST_BINDING);
    },
    async reportWebviewCapabilities() {
      events.push("caps:report");
    },
    setLocalMode(local) {
      events.push(`local:${local}`);
    },
    setLocalStore(status) {
      events.push(`store:${status?.localEntries ?? "none"}`);
    },
    setReady() {
      events.push("ready");
    },
    ...options.dependencies,
  };
  return { dependencies, events };
}

test("normal local browser gets the silent storage session before vault summaries", async () => {
  const { dependencies, events } = fixture({
    gateway: (record) => ({
      async waitForHealth() {
        record.push("health");
        return { profile: "local" };
      },
      async localStatus() {
        record.push("local-status");
        return localStatus;
      },
      async localSession() {
        record.push("local-session");
        return { email: "local@127.0.0.1" };
      },
    }),
  });

  await runStartup(dependencies);
  await Promise.resolve();

  assert.deepEqual(events, [
    "health",
    "local:true",
    "local-status",
    "store:2",
    "local-session",
    "session:local@127.0.0.1",
    "vaults:load",
    "bootstrap:local@127.0.0.1",
    "caps:report",
    "ready",
  ]);
});

test("bundled desktop never creates the browser-only local session", async () => {
  const { dependencies, events } = fixture({
    gateway: (record) => ({
      async waitForHealth() {
        record.push("health");
        return { profile: "local" };
      },
      async localStatus() {
        record.push("local-status");
        return localStatus;
      },
    }),
    dependencies: { isDesktop: () => true },
  });

  await runStartup(dependencies);

  assert.deepEqual(events, [
    "health",
    "local:true",
    "local-status",
    "store:2",
    "ready",
  ]);
});

test("an existing token restores the account and then loads vault summaries", async () => {
  const { dependencies, events } = fixture({
    dependencies: { hasToken: () => true },
  });

  await runStartup(dependencies);

  assert.deepEqual(events, [
    "health",
    "local:false",
    "me",
    "session:user@example.test",
    "vaults:load",
    "bootstrap:user@example.test",
    "ready",
  ]);
});

test("health failure keeps the existing authenticated-session fallback", async () => {
  const { dependencies, events } = fixture({
    gateway: (record) => ({
      async waitForHealth() {
        record.push("health:error");
        throw new TypeError("offline");
      },
      async me() {
        record.push("me:fallback");
        return { email: "user@example.test" };
      },
    }),
    dependencies: { hasToken: () => true },
  });

  await runStartup(dependencies);

  assert.deepEqual(events, [
    "health:error",
    "me:fallback",
    "session:user@example.test",
    "vaults:load",
    "bootstrap:user@example.test",
    "ready",
  ]);
});

test("failed restoration clears the session and startup still becomes ready", async () => {
  const { dependencies, events } = fixture({
    gateway: (record) => ({
      async waitForHealth() {
        record.push("health:error");
        throw new TypeError("offline");
      },
      async me() {
        record.push("me:error");
        throw new Error("expired");
      },
    }),
    dependencies: { hasToken: () => true },
  });

  await runStartup(dependencies);

  assert.deepEqual(events, ["health:error", "me:error", "session:none", "ready"]);
});

const cachedSummary = {
  vaultId: "cached-vault",
  cryptoProtocolVersion: 1,
  activeRevision: 4,
  activeVaultKeyVersion: 2,
  createdAt: "2026-11-13T00:00:00Z",
} as const;

beforeEach(() => {
  clearOfflineBootstrap();
});

test("transport failure uses cached identity/vault list only", async () => {
  await saveOfflineBootstrap("cached@example.test", [cachedSummary], TEST_BINDING);
  const { dependencies, events } = fixture({
    dependencies: { hasToken: () => true },
    gateway: (record) => ({
      async waitForHealth() {
        record.push("health:offline");
        throw new TypeError("fetch failed");
      },
      async me() {
        record.push("me:must-not-run");
        return { email: "user@example.test" };
      },
    }),
  });
  await runStartup(dependencies);
  assert.deepEqual(events, [
    "health:offline",
    "session:cached@example.test",
    "offline:cached@example.test",
    "ready",
  ]);
});

test("typed sidecar transport failure also uses the bound cache", async () => {
  await saveOfflineBootstrap("cached@example.test", [cachedSummary], TEST_BINDING);
  const { dependencies, events } = fixture({
    dependencies: { hasToken: () => true },
    gateway: (record) => ({
      async waitForHealth() {
        record.push("health:offline");
        throw new OfflineTransportError("offline_network");
      },
    }),
  });
  await runStartup(dependencies);
  assert.deepEqual(events, [
    "health:offline",
    "session:cached@example.test",
    "offline:cached@example.test",
    "ready",
  ]);
});

test("cold reload: me offline, cache bound to the current token restores it", async () => {
  await saveOfflineBootstrap("cached@example.test", [cachedSummary], TEST_BINDING);
  const { dependencies, events } = fixture({
    dependencies: { hasToken: () => true },
    gateway: (record) => ({
      async me() {
        record.push("me:offline");
        throw new TypeError("fetch failed");
      },
    }),
  });
  await runStartup(dependencies);
  assert.deepEqual(events, [
    "health",
    "local:false",
    "me:offline",
    "session:cached@example.test",
    "offline:cached@example.test",
    "ready",
  ]);
});

test("cold reload with a different token never restores the foreign cache", async () => {
  await saveOfflineBootstrap("cached@example.test", [cachedSummary], FOREIGN_BINDING);
  const { dependencies, events } = fixture({
    dependencies: { hasToken: () => true },
    gateway: (record) => ({
      async me() {
        record.push("me:offline");
        throw new TypeError("fetch failed");
      },
    }),
  });
  await runStartup(dependencies);
  // No bound cache: the established single online retry runs, then fails closed.
  assert.deepEqual(events, ["health", "local:false", "me:offline", "me:offline", "session:none", "ready"]);
});

test("cold reload with a different storage origin never restores the cache", async () => {
  await saveOfflineBootstrap("cached@example.test", [cachedSummary], {
    ...TEST_BINDING,
    storageOrigin: "https://other.example",
  });
  const { dependencies, events } = fixture({
    dependencies: { hasToken: () => true },
    gateway: (record) => ({
      async me() {
        record.push("me:offline");
        throw new TypeError("fetch failed");
      },
    }),
  });
  await runStartup(dependencies);
  assert.deepEqual(events, ["health", "local:false", "me:offline", "me:offline", "session:none", "ready"]);
});

test("me=B online, listVaults offline, cache=A: never restores account A", async () => {
  // Foreign binding (account A's token) — the loader must refuse it.
  await saveOfflineBootstrap("a@example.test", [cachedSummary], FOREIGN_BINDING);
  const { dependencies, events } = fixture({
    dependencies: {
      hasToken: () => true,
      async loadVaults() {
        events.push("vaults:offline");
        throw new TypeError("fetch failed");
      },
    },
    gateway: (record) => ({
      async me() {
        record.push("me:B");
        return { email: "b@example.test" };
      },
    }),
  });
  await runStartup(dependencies);
  assert.deepEqual(events, [
    "health",
    "local:false",
    "me:B",
    "session:b@example.test",
    "vaults:offline",
    "session:none",
    "ready",
  ]);
});

test("me=B online, listVaults offline, tampered cache email=A under B's binding: refused", async () => {
  await saveOfflineBootstrap("a@example.test", [cachedSummary], TEST_BINDING);
  const { dependencies, events } = fixture({
    dependencies: {
      hasToken: () => true,
      async loadVaults() {
        events.push("vaults:offline");
        throw new TypeError("fetch failed");
      },
    },
    gateway: (record) => ({
      async me() {
        record.push("me:B");
        return { email: "b@example.test" };
      },
    }),
  });
  await runStartup(dependencies);
  assert.deepEqual(events, [
    "health",
    "local:false",
    "me:B",
    "session:b@example.test",
    "vaults:offline",
    "session:none",
    "ready",
  ]);
});

test("me=B online, listVaults offline, cache bound to B: restores B", async () => {
  await saveOfflineBootstrap("b@example.test", [cachedSummary], TEST_BINDING);
  const { dependencies, events } = fixture({
    dependencies: {
      hasToken: () => true,
      async loadVaults() {
        events.push("vaults:offline");
        throw new TypeError("fetch failed");
      },
    },
    gateway: (record) => ({
      async me() {
        record.push("me:B");
        return { email: "b@example.test" };
      },
    }),
  });
  await runStartup(dependencies);
  assert.deepEqual(events, [
    "health",
    "local:false",
    "me:B",
    "session:b@example.test",
    "vaults:offline",
    "session:b@example.test",
    "offline:b@example.test",
    "ready",
  ]);
});

test("HTTP 401 is a server answer, not an offline fallback", async () => {
  await saveOfflineBootstrap("cached@example.test", [cachedSummary], TEST_BINDING);
  const { dependencies, events } = fixture({
    dependencies: { hasToken: () => true },
    gateway: (record) => ({
      async waitForHealth() {
        record.push("health:401");
        throw Object.assign(new Error("unauthorized"), { status: 401 });
      },
      async me() {
        record.push("me:401");
        throw Object.assign(new Error("unauthorized"), { status: 401 });
      },
    }),
  });
  await runStartup(dependencies);
  assert.deepEqual(events, ["health:401", "me:401", "session:none", "ready"]);
  assert.equal(events.some((event) => event.startsWith("offline:")), false);
});

for (const status of [403, 404, 409, 422, 500, 503]) {
  test(`HTTP ${status} never triggers the offline fallback`, async () => {
    await saveOfflineBootstrap("cached@example.test", [cachedSummary], TEST_BINDING);
    const { dependencies, events } = fixture({
      dependencies: { hasToken: () => true },
      gateway: (record) => ({
        async waitForHealth() {
          record.push(`health:${status}`);
          throw Object.assign(new Error(`http ${status}`), { status });
        },
        async me() {
          record.push(`me:${status}`);
          throw Object.assign(new Error(`http ${status}`), { status });
        },
      }),
    });
    await runStartup(dependencies);
    assert.deepEqual(events, [`health:${status}`, `me:${status}`, "session:none", "ready"]);
  });
}

test("protocol/validation errors are not transport failures", async () => {
  await saveOfflineBootstrap("cached@example.test", [cachedSummary], TEST_BINDING);
  const { dependencies, events } = fixture({
    dependencies: { hasToken: () => true },
    gateway: (record) => ({
      async waitForHealth() {
        record.push("health:protocol");
        throw Object.assign(new Error("sidecar request failed"), { code: "protocol" });
      },
      async me() {
        record.push("me:protocol");
        throw Object.assign(new Error("sidecar request failed"), { code: "validation" });
      },
    }),
  });
  await runStartup(dependencies);
  assert.deepEqual(events, ["health:protocol", "me:protocol", "session:none", "ready"]);
});

test("malformed or absent cached metadata fails closed", async () => {
  localStorage.setItem("4allpass.offline-bootstrap", JSON.stringify({ version: 1, email: "x", vaults: [{ vaultId: "" }] }));
  const { dependencies, events } = fixture({
    dependencies: { hasToken: () => true },
    gateway: (record) => ({
      async waitForHealth() {
        record.push("health:offline");
        throw new TypeError("fetch failed");
      },
      async me() {
        record.push("me:error");
        throw new TypeError("fetch failed");
      },
    }),
  });
  await runStartup(dependencies);
  assert.deepEqual(events, ["health:offline", "me:error", "session:none", "ready"]);
});
