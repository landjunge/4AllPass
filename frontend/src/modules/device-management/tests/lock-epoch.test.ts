import "../../../lib/test-storage-shim.ts";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { api, type DeviceSummary } from "../../../lib/api.ts";
import { lock as lockVault, type UnlockedVault } from "../../../lib/vault-session.ts";
import { captureVaultLiveness, VaultLockedError } from "../../../lib/vault-liveness.ts";
import { clearTestStorage } from "../../../lib/test-storage-shim.ts";
import { createDeviceMutations } from "../device-mutations.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const originalRegisterDevice = api.registerDevice.bind(api);
const originalRevoke = api.revokeDevice.bind(api);
const originalCommit = api.commitSnapshot.bind(api);

afterEach(() => {
  clearTestStorage();
  api.registerDevice = originalRegisterDevice;
  api.revokeDevice = originalRevoke;
  api.commitSnapshot = originalCommit;
});

function vaultFixture(): UnlockedVault {
  return {
    vaultId: "synthetic-vault",
    revision: 1,
    vaultKeyVersion: 1,
    vaultKey: new Uint8Array(32).fill(7),
    envelopes: [],
    entries: [
      {
        id: "entry_demo",
        title: "Demo",
        username: "u",
        password: "synthetic-secret",
        url: "",
        notes: "synthetic-note",
        totpSecret: "synthetic-totp",
        updatedAt: new Date().toISOString(),
      } as UnlockedVault["entries"][number],
    ],
    unlockedWith: "master_password",
  };
}

function fixture() {
  const vault = vaultFixture();
  const events: string[] = [];
  let epoch = 0;
  let current: UnlockedVault | null = vault;
  const mutations = createDeviceMutations(() => ({
    currentVault: () => current,
    captureVaultLiveness: (target) =>
      captureVaultLiveness(target, () => epoch, () => current),
    replaceUnlockedVault: (next) => { events.push("adopt"); current = next; },
    setDeviceUnlockAvailable: (available) => events.push(`device-unlock:${available}`),
    setDevices: () => events.push("devices"),
  }));
  return {
    vault,
    events,
    mutations,
    current: () => current,
    lockNow() {
      epoch += 1;
      if (current) lockVault(current);
      current = null;
      events.push("lock");
    },
  };
}

test("soft revoke: lock during DELETE aborts before commit and stays locked", async () => {
  const f = fixture();
  const deletion = deferred<DeviceSummary>();
  const calls: string[] = [];
  api.revokeDevice = () => { calls.push("delete"); return deletion.promise; };
  api.commitSnapshot = async () => { calls.push("commit"); throw new Error("must not commit"); };

  const operation = f.mutations.revoke("dev_target_device");
  await settle();
  f.lockNow();
  deletion.resolve({} as DeviceSummary);

  await assert.rejects(operation, VaultLockedError);
  assert.equal(f.current(), null);
  assert.deepEqual(calls, ["delete"]);
  assert.ok(!f.events.includes("adopt"));
  assert.ok(f.vault.vaultKey.every((byte) => byte === 0));
  assert.equal(f.vault.entries[0]?.password, "");
  assert.equal(f.vault.entries[0]?.notes, "");
  assert.equal(f.vault.entries[0]?.totpSecret, "");
});

test("enable biometrics: lock during device registration aborts before ceremony and commit", async () => {
  const f = fixture();
  const registration = deferred<DeviceSummary>();
  const calls: string[] = [];
  api.registerDevice = () => { calls.push("register"); return registration.promise; };
  api.commitSnapshot = async () => { calls.push("commit"); throw new Error("must not commit"); };

  const operation = f.mutations.enableBiometrics("synthetic@example.invalid");
  await settle();
  f.lockNow();
  registration.resolve({} as DeviceSummary);

  await assert.rejects(operation, VaultLockedError);
  assert.equal(f.current(), null);
  assert.deepEqual(calls, ["register"]);
  assert.ok(!f.events.includes("adopt"));
  assert.ok(f.vault.vaultKey.every((byte) => byte === 0));
});
