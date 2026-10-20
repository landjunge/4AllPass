import "../../../lib/test-storage-shim.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeviceSummary } from "../../../lib/api.ts";
import type { UnlockedVault } from "../../../lib/vault-session.ts";
import type { CommittedHardRevoke } from "../../../lib/hard-revoke-result.ts";
import { createHardRevokeCoordinator, type RevokeProgress } from "../hard-revoke-coordinator.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Caller tests deliberately replace transport/crypto with controlled receipts.
// The sibling vault-session suite separately proves genuine CAS/keys/pins.
function fixture(selfRevoked = false) {
  const old = { vaultId: "synthetic-vault", revision: 1, vaultKey: new Uint8Array(32).fill(1), entries: [] } as unknown as UnlockedVault;
  const next = { ...old, revision: 2, vaultKey: new Uint8Array(32).fill(2), envelopes: [] } as UnlockedVault;
  const result: CommittedHardRevoke = { vault: next, targetDeviceId: "synthetic-target", selfRevoked };
  const events: string[] = [];
  let current: UnlockedVault | null = old;
  let account = "synthetic@example.invalid";
  let activeVaultId = old.vaultId;
  let progress: RevokeProgress | null = null;
  let devices: DeviceSummary[] = [];
  const dependencies = {
    async commit(): Promise<CommittedHardRevoke> { events.push("commit"); return result; },
    async revoke(): Promise<DeviceSummary> { events.push("delete"); return {} as DeviceSummary; },
    async list(): Promise<DeviceSummary[]> { events.push("get"); return []; },
  };
  const coordinator = createHardRevokeCoordinator(() => ({
    currentVault: () => current,
    getActiveVaultId: () => activeVaultId,
    getAccountEmail: () => account,
    replaceUnlockedVault: (value) => { events.push(value ? "adopt" : "self-lock"); current = value; },
    setDeviceUnlockAvailable: () => events.push("device-unlock-off"),
    setDevices: (value) => { events.push("devices"); devices = value; },
    showNotice: () => events.push("notice"),
    progress: (value) => { progress = value; },
  }), dependencies);
  return { old, next, result, events, dependencies, coordinator,
    current: () => current, progress: () => progress, devices: () => devices,
    setCurrent: (value: UnlockedVault | null) => { current = value; },
    setAccount: (value: string) => { account = value; },
    setActive: (value: string) => { activeVaultId = value; },
  };
}

test("adopts committed vault before failed DELETE; retry is metadata-only", async () => {
  const f = fixture();
  f.dependencies.revoke = async () => { f.events.push("delete"); throw new Error("synthetic 503"); };
  await f.coordinator.hardRevoke("synthetic-target", "synthetic-only");
  await settle();
  assert.equal(f.current(), f.next);
  assert.deepEqual(f.events, ["commit", "adopt", "device-unlock-off", "delete"]);
  assert.deepEqual(f.progress(), { phase: "revoke_pending", busy: false });
  await assert.rejects(f.coordinator.hardRevoke("synthetic-target", "synthetic-only"), /hard_revoke_pending/);
  f.dependencies.revoke = async () => { f.events.push("delete"); return {} as DeviceSummary; };
  await f.coordinator.reconcile();
  assert.equal(f.progress(), null);
  assert.equal(f.events.filter((event) => event === "commit").length, 1);
  assert.deepEqual(f.events.slice(-4), ["delete", "get", "devices", "notice"]);
});

test("self-lock is adopted before metadata can stall, form promise resolves at commit", async () => {
  const f = fixture(true);
  const deletion = deferred<DeviceSummary>();
  f.dependencies.revoke = () => { f.events.push("delete"); return deletion.promise; };
  await f.coordinator.hardRevoke("synthetic-target", "synthetic-only");
  assert.equal(f.current(), null);
  assert.deepEqual(f.events, ["commit", "self-lock", "device-unlock-off", "delete"]);
  assert.deepEqual(f.progress(), { phase: "revoke_pending", busy: true });
  deletion.reject(new Error("synthetic 503"));
  await settle();
  assert.deepEqual(f.progress(), { phase: "revoke_pending", busy: false });
});

test("acknowledged DELETE plus failed GET retries GET only", async () => {
  const f = fixture();
  f.dependencies.list = async () => { f.events.push("get"); throw new Error("synthetic GET failure"); };
  await f.coordinator.hardRevoke("synthetic-target", "synthetic-only");
  await settle();
  assert.deepEqual(f.progress(), { phase: "refresh_pending", busy: false });
  f.dependencies.list = async () => { f.events.push("get"); return []; };
  await f.coordinator.reconcile();
  assert.equal(f.progress(), null);
  assert.equal(f.events.filter((event) => event === "delete").length, 1);
  assert.equal(f.events.filter((event) => event === "commit").length, 1);
});

test("CAS failure preserves caller and performs no metadata action", async () => {
  const f = fixture();
  f.dependencies.commit = async () => { f.events.push("commit"); throw new Error("synthetic CAS409"); };
  await assert.rejects(f.coordinator.hardRevoke("synthetic-target", "synthetic-only"), /CAS409/);
  assert.equal(f.current(), f.old);
  assert.equal(f.progress(), null);
  assert.deepEqual(f.events, ["commit"]);
});

test("concurrent rotation and reconciliation cannot duplicate requests", async () => {
  const f = fixture();
  const commit = deferred<CommittedHardRevoke>();
  const deletion = deferred<DeviceSummary>();
  f.dependencies.commit = () => { f.events.push("commit"); return commit.promise; };
  f.dependencies.revoke = () => { f.events.push("delete"); return deletion.promise; };
  const first = f.coordinator.hardRevoke("synthetic-target", "synthetic-only");
  await assert.rejects(f.coordinator.hardRevoke("synthetic-target", "synthetic-only"), /hard_revoke_pending/);
  commit.resolve(f.result);
  await first;
  await Promise.all([f.coordinator.reconcile(), f.coordinator.reconcile()]);
  assert.deepEqual(f.events, ["commit", "adopt", "device-unlock-off", "delete"]);
  deletion.resolve({} as DeviceSummary);
  await settle();
});

test("clear during CAS locks orphan receipt and prevents old account callbacks", async () => {
  const f = fixture();
  const commit = deferred<CommittedHardRevoke>();
  f.dependencies.commit = () => commit.promise;
  const operation = f.coordinator.hardRevoke("synthetic-target", "synthetic-only");
  f.coordinator.clear();
  commit.resolve(f.result);
  await operation;
  assert.ok(f.next.vaultKey.every((byte) => byte === 0));
  assert.equal(f.current(), f.old);
  assert.equal(f.progress(), null);
  assert.deepEqual(f.events, []);
});

test("account change during CAS cannot adopt receipt even without clear callback", async () => {
  const f = fixture();
  const commit = deferred<CommittedHardRevoke>();
  f.dependencies.commit = () => commit.promise;
  const operation = f.coordinator.hardRevoke("synthetic-target", "synthetic-only");
  f.setAccount("another@example.invalid");
  commit.resolve(f.result);
  await operation;
  assert.ok(f.next.vaultKey.every((byte) => byte === 0));
  assert.deepEqual(f.events, []);
});

test("clear during DELETE suppresses subsequent GET and pending notice", async () => {
  const f = fixture();
  const deletion = deferred<DeviceSummary>();
  f.dependencies.revoke = () => deletion.promise;
  await f.coordinator.hardRevoke("synthetic-target", "synthetic-only");
  f.coordinator.clear();
  deletion.resolve({} as DeviceSummary);
  await settle();
  assert.equal(f.progress(), null);
  assert.ok(!f.events.includes("get"));
  assert.ok(!f.events.includes("notice"));
});

test("clear during GET suppresses stale list and success callbacks", async () => {
  const f = fixture();
  const listing = deferred<DeviceSummary[]>();
  f.dependencies.list = () => listing.promise;
  await f.coordinator.hardRevoke("synthetic-target", "synthetic-only");
  f.coordinator.clear();
  listing.resolve([{} as DeviceSummary]);
  await settle();
  assert.deepEqual(f.devices(), []);
  assert.equal(f.progress(), null);
  assert.ok(!f.events.includes("notice"));
});

test("locking or switching vault during CAS never reopens the committed vault", async () => {
  const f = fixture();
  const commit = deferred<CommittedHardRevoke>();
  f.dependencies.commit = () => commit.promise;
  const operation = f.coordinator.hardRevoke("synthetic-target", "synthetic-only");
  f.setCurrent(null);
  f.setActive("another-vault");
  commit.resolve(f.result);
  await operation;
  await settle();
  assert.equal(f.current(), null);
  assert.ok(f.next.vaultKey.every((byte) => byte === 0));
  assert.ok(!f.events.includes("devices"));
  assert.ok(!f.events.includes("adopt"));
  assert.ok(!f.events.includes("device-unlock-off"));
});

test("self-revoke that completes after manual lock removes device unlock without reopening", async () => {
  const f = fixture(true);
  const commit = deferred<CommittedHardRevoke>();
  f.dependencies.commit = () => commit.promise;
  const operation = f.coordinator.hardRevoke("synthetic-target", "synthetic-only");
  f.setCurrent(null);
  commit.resolve(f.result);
  await operation;
  await settle();
  assert.equal(f.current(), null);
  assert.ok(f.events.includes("device-unlock-off"));
  assert.ok(!f.events.includes("adopt"));
  assert.ok(f.next.vaultKey.every((byte) => byte === 0));
});
