import "../../../lib/test-storage-shim.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { lock as lockVault, type UnlockedVault } from "../../../lib/vault-session.ts";
import type { VaultEntry } from "../../../lib/entries.ts";
import { captureVaultLiveness, VaultLockedError } from "../../../lib/vault-liveness.ts";
import type { LocalStoreStatus } from "../../startup/index.ts";
import { pullLocalEntries, type PullLocalDependencies } from "../pull-local.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function vaultFixture(): UnlockedVault {
  return {
    vaultId: "synthetic-open-vault",
    revision: 3,
    vaultKeyVersion: 1,
    vaultKey: new Uint8Array(32).fill(4),
    envelopes: [],
    entries: [],
    unlockedWith: "master_password",
  };
}

function entryFixture(): VaultEntry {
  return {
    id: "entry_imported",
    title: "Imported",
    username: "u",
    password: "synthetic-imported-secret",
    url: "",
    notes: "synthetic-imported-note",
    totpSecret: "synthetic-imported-totp",
    updatedAt: new Date().toISOString(),
  } as VaultEntry;
}

const status: LocalStoreStatus = {
  hasLocalVault: false,
  localEntries: 1,
  hasOtherAccounts: true,
  localVaultId: "synthetic-source-vault",
};

test("pull-local: lock while decrypting never commits imported plaintext and stays locked", async () => {
  const vault = vaultFixture();
  const decryption = deferred<VaultEntry[]>();
  const incoming = [entryFixture()];
  const events: string[] = [];
  const dependencies: PullLocalDependencies = {
    localStatus: async () => status,
    adoptLocalVault: async () => { events.push("adopt-local"); return { vaultId: "synthetic-source-vault", entries: 1 }; },
    listVaults: async () => { events.push("list"); return []; },
    decryptEntries: () => { events.push("decrypt"); return decryption.promise; },
    commitEntries: async () => { events.push("commit"); return vaultFixture(); },
    lock: (next) => { events.push("zeroize"); lockVault(next); },
  };

  let current: UnlockedVault | null = vault;
  let epoch = 0;
  const liveness = captureVaultLiveness(vault, () => epoch, () => current);
  const operation = pullLocalEntries(
    { current: vault, masterPassword: "synthetic-master", liveness },
    dependencies,
  ).then((next) => {
    events.push("adopt");
    current = next;
  });

  await settle();
  assert.deepEqual(events, ["list", "decrypt"]);
  epoch += 1;
  lockVault(vault);
  current = null;
  decryption.resolve(incoming);

  await assert.rejects(operation, VaultLockedError);
  assert.equal(current, null);
  assert.ok(!events.includes("commit"));
  assert.ok(!events.includes("adopt"));
  assert.equal(incoming[0]?.password, "");
  assert.equal(incoming[0]?.notes, "");
  assert.equal(incoming[0]?.totpSecret, "");
});

test("pull-local: a commit that resolves after lock is zeroized, not adopted", async () => {
  const vault = vaultFixture();
  const commit = deferred<UnlockedVault>();
  const next = { ...vaultFixture(), revision: 4, vaultKey: new Uint8Array(32).fill(5) };
  const events: string[] = [];
  const dependencies: PullLocalDependencies = {
    localStatus: async () => status,
    adoptLocalVault: async () => ({ vaultId: "synthetic-source-vault", entries: 1 }),
    listVaults: async () => [],
    decryptEntries: async () => [entryFixture()],
    commitEntries: () => { events.push("commit"); return commit.promise; },
    lock: (value) => { events.push("zeroize"); lockVault(value); },
  };

  let current: UnlockedVault | null = vault;
  let epoch = 0;
  const liveness = captureVaultLiveness(vault, () => epoch, () => current);
  const operation = pullLocalEntries(
    { current: vault, masterPassword: "synthetic-master", liveness },
    dependencies,
  ).then((value) => {
    events.push("adopt");
    current = value;
  });

  await settle();
  assert.deepEqual(events, ["commit"]);
  epoch += 1;
  lockVault(vault);
  current = null;
  commit.resolve(next);

  await assert.rejects(operation, VaultLockedError);
  assert.equal(current, null);
  assert.ok(!events.includes("adopt"));
  assert.ok(events.includes("zeroize"));
  assert.ok(next.vaultKey.every((byte) => byte === 0));
});
