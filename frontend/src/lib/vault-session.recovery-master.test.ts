import "./test-storage-shim.ts";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import {
  AuthFailureError, buildManifest, decodeVaultSnapshot,
  encodeVaultSnapshot, formatRecoveryKey, generateDeviceKey, generateRecoveryKey,
  IntegrityError, sealManifest, sealedManifestDigest, wrapVaultKey,
} from "@4allpass/crypto";
import { api, ApiError, type WireVaultSnapshot } from "./api.ts";
import { loadPin } from "./revision-pin.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { memorySnapshotCache, setSnapshotCacheForTests } from "./snapshot-cache.ts";
import {
  CommitConflict, commitEntries, createVault, hardRevokeDevice, lock,
  persistDeferredPin, rotateCompromisedRecovery, setMasterPasswordAfterRecovery,
  unlockWithMasterPassword, unlockWithRecoveryKey,
} from "./vault-session.ts";
import { replaceMasterAfterRecovery } from "./recovery-master.ts";
import { createRecoveryMasterCoordinator, type RecoveryMasterOffer } from "../modules/recovery-management/master-coordinator.ts";

const OLD = "synthetic-original-master";
const NEXT = "Neue synthetische Passphrase e\u0301 🚀";
const ID = "synthetic-recovery-master-vault";
const originals = { create: api.createVault, commit: api.commitSnapshot, get: api.getSnapshot };
let base: WireVaultSnapshot;
let head: WireVaultSnapshot;
let kit: string;
let oldKey: Uint8Array;
let commits = 0;
function echo(vaultId: string, payload: Parameters<typeof api.commitSnapshot>[1]): WireVaultSnapshot {
  return { vaultId, revision: payload.revision, vaultKeyVersion: payload.vaultKeyVersion,
    cryptoProtocolVersion: 1, envelopes: payload.envelopes, entries: payload.entries, sealedManifest: payload.sealedManifest };
}
function transport(): void {
  api.getSnapshot = async () => structuredClone(head);
  api.commitSnapshot = async (id, payload) => {
    commits++;
    if (head && payload.expectedRevision !== head.revision) throw new ApiError(409, {});
    head = echo(id, payload);
    return structuredClone(head);
  };
}
before(async () => {
  setSnapshotCacheForTests(memorySnapshotCache());
  api.createVault = async () => ({ vaultId: ID, cryptoProtocolVersion: 1, activeRevision: null, activeVaultKeyVersion: null, createdAt: "2026-10-20T00:00:00Z" });
  transport();
  const created = await createVault(OLD, "mobile_safe");
  kit = created.recoveryKey;
  oldKey = new Uint8Array(created.vault.vaultKey);
  created.vault.envelopes.push(wrapVaultKey({ vaultKey: created.vault.vaultKey,
    wrappingKey: generateDeviceKey(), vaultId: ID, type: "device", vaultKeyVersion: 1,
    deviceId: "dev_synthetic_recovery_01", deviceKeyVersion: 1 }));
  const updated = await commitEntries(created.vault, [{ id: "entry_synthetic", title: "Synthetic survivor",
    username: "u", password: "synthetic-entry-only", notes: "", url: "", updatedAt: "2026-10-20T00:00:00Z" }]);
  base = structuredClone(head);
  lock(updated);
});
beforeEach(() => {
  clearTestStorage();
  setSnapshotCacheForTests(memorySnapshotCache());
  head = structuredClone(base);
  commits = 0;
  transport();
});
after(() => {
  api.createVault = originals.create; api.commitSnapshot = originals.commit; api.getSnapshot = originals.get;
  clearTestStorage(); setSnapshotCacheForTests(null);
});

test("actual kit unlock changes master without old password, preserves VK/devices/kit and validates Unicode", async () => {
  const vault = await unlockWithRecoveryKey(ID, kit);
  const initial = new Uint8Array(vault.vaultKey);
  const updated = await setMasterPasswordAfterRecovery(vault, { newMasterPassword: NEXT, recoveryKeyText: kit });
  assert.equal(updated.revision, 3);
  assert.equal(updated.vaultKeyVersion, 1);
  assert.deepEqual(updated.vaultKey, initial);
  assert.notEqual(updated.vaultKey, vault.vaultKey);
  assert.ok(vault.vaultKey.every((b) => b === 0));
  assert.deepEqual(head.envelopes.filter((e) => e.type !== "master"), base.envelopes.filter((e) => e.type !== "master"));
  const previousMaster = base.envelopes.find((e) => e.type === "master")!;
  const nextMaster = head.envelopes.find((e) => e.type === "master")!;
  assert.notEqual(nextMaster.kdf!.salt, previousMaster.kdf!.salt);
  const { salt: _old, ...params } = previousMaster.kdf!;
  const { salt: _next, ...nextParams } = nextMaster.kdf!;
  assert.deepEqual(nextParams, params);
  assert.equal(updated.entries[0]?.password, "synthetic-entry-only");
  assert.equal(loadPin(ID)?.revision, 3);
  await assert.rejects(unlockWithMasterPassword(ID, OLD), AuthFailureError);
  const reopened = await unlockWithMasterPassword(ID, NEXT.normalize("NFC"));
  assert.equal(reopened.entries[0]?.password, "synthetic-entry-only");
  const byKit = await unlockWithRecoveryKey(ID, kit);
  assert.deepEqual(byKit.vaultKey, initial);
  // Password replacement is deliberately NOT a revocation of prior VK holders.
  assert.deepEqual(byKit.vaultKey, oldKey);
  assert.equal(commits, 1);
  assert.ok(!JSON.stringify(head).includes(NEXT));
  assert.ok(!JSON.stringify(head).includes(kit));
});

test("empty or too-short master passwords are rejected before any commit", async () => {
  const vault = await unlockWithRecoveryKey(ID, kit);
  const before = commits;
  const pinBefore = loadPin(ID);
  await assert.rejects(
    () => setMasterPasswordAfterRecovery(vault, { newMasterPassword: "", recoveryKeyText: kit }),
    /at least 10/,
  );
  await assert.rejects(
    () => setMasterPasswordAfterRecovery(vault, { newMasterPassword: "short", recoveryKeyText: kit }),
    /at least 10/,
  );
  assert.equal(commits, before);
  assert.deepEqual(loadPin(ID), pinBefore, "no pin movement for a rejected password");
  lock(vault);
});

test("a recovery tag alone and another kit cannot authorize a write", async () => {
  const vault = await unlockWithRecoveryKey(ID, kit);
  const prior = new Uint8Array(vault.vaultKey);
  await assert.rejects(setMasterPasswordAfterRecovery(vault, {
    newMasterPassword: NEXT, recoveryKeyText: formatRecoveryKey(generateRecoveryKey()),
  }), AuthFailureError);
  assert.deepEqual(vault.vaultKey, prior);
  assert.equal(commits, 0);
});

test("a master-unlocked context is not this recovery continuation", async () => {
  const vault = await unlockWithMasterPassword(ID, OLD);
  await assert.rejects(setMasterPasswordAfterRecovery(vault, { newMasterPassword: NEXT, recoveryKeyText: kit }), IntegrityError);
  assert.equal(commits, 0);
});

test("recovery proof must match the actual current VK", async () => {
  const vault = await unlockWithRecoveryKey(ID, kit);
  vault.vaultKey = generateDeviceKey();
  const prior = new Uint8Array(vault.vaultKey);
  await assert.rejects(setMasterPasswordAfterRecovery(vault, { newMasterPassword: NEXT, recoveryKeyText: kit }), IntegrityError);
  assert.deepEqual(vault.vaultKey, prior);
  assert.equal(commits, 0);
});

test("kit confirmation binds vault identity and VK generation", async () => {
  for (const changed of ["identity", "version"]) {
    const vault = await unlockWithRecoveryKey(ID, kit);
    if (changed === "identity") vault.vaultId = "another-vault";
    else vault.vaultKeyVersion++;
    await assert.rejects(setMasterPasswordAfterRecovery(vault, { newMasterPassword: NEXT, recoveryKeyText: kit }));
  }
  assert.equal(commits, 0);
});

test("CAS409 leaves the existing VK and pin intact", async () => {
  const vault = await unlockWithRecoveryKey(ID, kit);
  const prior = new Uint8Array(vault.vaultKey);
  const pin = loadPin(ID);
  api.commitSnapshot = async () => { throw new ApiError(409, {}); };
  await assert.rejects(setMasterPasswordAfterRecovery(vault, { newMasterPassword: NEXT, recoveryKeyText: kit }), CommitConflict);
  assert.deepEqual(vault.vaultKey, prior);
  assert.deepEqual(loadPin(ID), pin);
});

test("an authentic returned snapshot with old master is refused BEFORE pin", async () => {
  const vault = await unlockWithRecoveryKey(ID, kit);
  const pin = loadPin(ID);
  const prior = new Uint8Array(vault.vaultKey);
  api.commitSnapshot = async (id, payload) => {
    const decoded = decodeVaultSnapshot(echo(id, payload));
    const oldMaster = decodeVaultSnapshot(base).envelopes.find((env) => env.type === "master")!;
    decoded.envelopes = decoded.envelopes.map((env) => env.type === "master" ? oldMaster : env);
    decoded.sealedManifest = sealManifest({ vaultKey: oldKey, manifest: buildManifest({
      vaultId: ID, revision: decoded.revision, vaultKeyVersion: 1,
      envelopes: decoded.envelopes, entries: decoded.entries,
    }) });
    return encodeVaultSnapshot(decoded);
  };
  await assert.rejects(setMasterPasswordAfterRecovery(vault, { newMasterPassword: NEXT, recoveryKeyText: kit }), IntegrityError);
  assert.deepEqual(loadPin(ID), pin);
  assert.deepEqual(vault.vaultKey, prior);
});

test("tampered returned content cannot advance the pin", async () => {
  const vault = await unlockWithRecoveryKey(ID, kit);
  const pin = loadPin(ID);
  api.commitSnapshot = async (id, payload) => {
    const result = echo(id, payload);
    result.entries = [];
    return result;
  };
  await assert.rejects(setMasterPasswordAfterRecovery(vault, { newMasterPassword: NEXT, recoveryKeyText: kit }), IntegrityError);
  assert.deepEqual(loadPin(ID), pin);
});

test("failed commit clears only temporary kit/derived/new-buffer material", async () => {
  const vault = await unlockWithRecoveryKey(ID, kit);
  const prior = new Uint8Array(vault.vaultKey);
  let capturedKey: Uint8Array | null = null;
  let capturedMaster: Uint8Array | null = null;
  await assert.rejects(replaceMasterAfterRecovery(vault, { newMasterPassword: NEXT, recoveryKeyText: kit }, async (_env, key, master) => {
    capturedKey = key; capturedMaster = master; throw new Error("synthetic failure");
  }), /synthetic failure/);
  assert.ok(capturedKey && (capturedKey as Uint8Array).every((b) => b === 0));
  assert.ok(capturedMaster && (capturedMaster as Uint8Array).every((b) => b === 0));
  assert.deepEqual(vault.vaultKey, prior);
});

test("productive coordinator adopts the actual verified reset before offering devices", async () => {
  let current = await unlockWithRecoveryKey(ID, kit);
  let offer: RecoveryMasterOffer | null = null;
  const flow = createRecoveryMasterCoordinator(() => ({
    currentVault: () => current, getActiveVaultId: () => ID, getAccountEmail: () => "synthetic@example.invalid",
    passwordsCollide: () => false, replaceUnlockedVault: (value) => { current = value; }, publish: (value) => { offer = value; },
  }));
  flow.begin(current);
  await flow.complete(NEXT, kit);
  assert.equal(current.revision, 3);
  assert.equal(current.entries[0]?.password, "synthetic-entry-only");
  assert.equal((offer as RecoveryMasterOffer | null)?.stage, "devices");
  assert.equal(loadPin(ID)?.revision, 3);
  assert.equal(commits, 1);
});

test("deferred recovery pin retries a storage failure without another server commit", async () => {
  const vault = await unlockWithRecoveryKey(ID, kit);
  const updated = await setMasterPasswordAfterRecovery(vault, {
    newMasterPassword: NEXT, recoveryKeyText: kit, deferPin: true,
  });
  const storage = localStorage;
  const key = `4allpass.pin.${ID}`;
  const before = storage.getItem(key);
  const original = Object.getOwnPropertyDescriptor(storage, "setItem");
  const originalSetItem = storage.setItem;
  const failure = new Error("synthetic pin storage refusal");
  const attempts: string[] = [];
  let failWrite = true;
  try {
    assert.equal(commits, 1);
    assert.equal(loadPin(ID)?.revision, 2, "the completed commit has not adopted its pin");
    Object.defineProperty(storage, "setItem", {
      configurable: true,
      writable: true,
      value(writeKey: string, value: string) {
        if (writeKey === key) {
          attempts.push(value);
          if (failWrite) throw failure;
        }
        originalSetItem.call(storage, writeKey, value);
      },
    });
    assert.throws(() => persistDeferredPin(ID, updated.revision), (error) => error === failure);
    assert.equal(storage.getItem(key), before);
    assert.equal(attempts.length, 1);
    assert.equal(commits, 1);
    // Absent neighbouring keys do not consume this pending pin.
    persistDeferredPin(`${ID}-other`, updated.revision);
    persistDeferredPin(ID, updated.revision + 1);
    assert.equal(attempts.length, 1);
    failWrite = false;
    persistDeferredPin(ID, updated.revision);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1], attempts[0], "retry stores exactly the refused pin bytes");
    const decoded = decodeVaultSnapshot(head);
    assert.ok(decoded.sealedManifest);
    assert.deepEqual(loadPin(ID), {
      vaultId: ID, revision: updated.revision, vaultKeyVersion: updated.vaultKeyVersion,
      cryptoProtocolVersion: 1, manifestDigest: sealedManifestDigest(decoded.sealedManifest),
    });
    persistDeferredPin(ID, updated.revision);
    assert.equal(attempts.length, 2, "a successful save removes the deferred pin");
    assert.equal(commits, 1, "persistence retry never replays the server commit");
  } finally {
    if (original) Object.defineProperty(storage, "setItem", original);
    else Reflect.deleteProperty(storage, "setItem");
    lock(updated);
  }
});

test("actual reset completed after manual lock/account clear cannot reopen or retain plaintext", async () => {
  const vault = await unlockWithRecoveryKey(ID, kit);
  let current: typeof vault | null = vault;
  let result: typeof vault | null = null;
  let offer: RecoveryMasterOffer | null = null;
  let release!: () => void;
  const gate = new Promise<void>((yes) => { release = yes; });
  api.commitSnapshot = async (id, payload) => { await gate; return echo(id, payload); };
  const flow = createRecoveryMasterCoordinator(() => ({
    currentVault: () => current, getActiveVaultId: () => ID, getAccountEmail: () => "synthetic@example.invalid",
    passwordsCollide: () => false, replaceUnlockedVault: (value) => { current = value; }, publish: (value) => { offer = value; },
  }), async (value, options) => { result = await setMasterPasswordAfterRecovery(value, { ...options, deferPin: true }); return result; });
  flow.begin(vault);
  const operation = flow.complete(NEXT, kit);
  lock(vault); current = null; flow.clear();
  release(); await operation;
  assert.equal(current, null);
  assert.equal(offer, null);
  assert.ok(result && (result as typeof vault).vaultKey.every((b) => b === 0));
  assert.ok(!(result as typeof vault | null)?.entries[0]?.password);
  assert.equal(loadPin(ID)?.revision, 2, "a stale commit must not move the pin; the server head advances, the UI stays locked");
});

test("trusted kit still opens the head after a hard revoke (user flow)", async () => {
  const vault = await unlockWithMasterPassword(ID, OLD);
  const revoked = await hardRevokeDevice(vault, {
    targetDeviceId: "dev_other_synthetic_revoke",
    masterPassword: OLD,
    recoveryKeyText: kit,
  });
  assert.equal(revoked.vault.vaultKeyVersion, 2);
  assert.equal(revoked.vault.revision, 3);
  lock(revoked.vault);

  const reopened = await unlockWithRecoveryKey(ID, kit);
  assert.equal(reopened.vaultKeyVersion, 2);
  assert.equal(reopened.entries[0]?.password, "synthetic-entry-only");
  lock(reopened);
});

test("rotated kit: old print opens a historic copy, not the new head; new print opens the head", async () => {
  const vault = await unlockWithMasterPassword(ID, OLD);
  const historic = structuredClone(head);
  const rotated = await rotateCompromisedRecovery(vault, {
    masterPassword: OLD,
    previousRecoveryKeyText: kit,
  });
  assert.equal(rotated.vault.vaultKeyVersion, 2);
  assert.notEqual(rotated.recoveryKey, kit);

  await assert.rejects(() => unlockWithRecoveryKey(ID, kit), AuthFailureError);
  const byNew = await unlockWithRecoveryKey(ID, rotated.recoveryKey);
  assert.equal(byNew.vaultKeyVersion, 2);
  assert.equal(byNew.entries[0]?.password, "synthetic-entry-only");
  lock(byNew);

  // A copied historic snapshot (fresh profile, no pin) still opens with the old
  // print; it does not become the current head.
  clearTestStorage();
  setSnapshotCacheForTests(memorySnapshotCache());
  api.getSnapshot = async () => structuredClone(historic);
  const historicVault = await unlockWithRecoveryKey(ID, kit);
  assert.equal(historicVault.vaultKeyVersion, 1);
  assert.equal(historicVault.entries[0]?.password, "synthetic-entry-only");
  lock(historicVault);
});
