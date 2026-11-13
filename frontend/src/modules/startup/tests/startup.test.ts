import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import "../../../lib/test-storage-shim.ts";
import { clearOfflineBootstrap, saveOfflineBootstrap } from "../../../lib/offline-bootstrap.ts";

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
    saveOfflineBootstrap(email) {
      events.push(`bootstrap:${email}`);
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
  saveOfflineBootstrap("cached@example.test", [cachedSummary]);
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

test("HTTP 401 is a server answer, not an offline fallback", async () => {
  saveOfflineBootstrap("cached@example.test", [cachedSummary]);
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
