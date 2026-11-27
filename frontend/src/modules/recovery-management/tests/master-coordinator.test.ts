import "../../../lib/test-storage-shim.ts";
import assert from "node:assert/strict";
import { after, afterEach, mock, test } from "node:test";
import type { UnlockedVault } from "../../../lib/vault-session.ts";
import type { RecoveryMasterOffer } from "../master-coordinator.ts";
import * as session from "../../../lib/vault-session.ts";
import { captureVaultLiveness, type VaultLiveness } from "../../../lib/vault-liveness.ts";
let persist = () => {};
mock.module("../../../lib/vault-session.ts", { namedExports: { ...session, persistDeferredPin: () => persist() } });
const { createRecoveryMasterCoordinator } = await import("../master-coordinator.ts");
afterEach(() => { persist = () => {}; });
after(() => mock.restoreAll());

function fixture() {
  const old = { vaultId: "synthetic-master-flow", revision: 2, vaultKey: new Uint8Array(32).fill(1),
    entries: [], unlockedWith: "recovery_key" } as unknown as UnlockedVault;
  const next = { ...old, revision: 3, vaultKey: new Uint8Array(32).fill(1) };
  let current: UnlockedVault | null = old;
  let active = old.vaultId;
  let account = "synthetic@example.invalid";
  let collide = false;
  let offer: RecoveryMasterOffer | null = null;
  let calls = 0;
  let resetLiveness: VaultLiveness | undefined;
  let epoch = 0;
  let onPublish = () => {};
  let onReplace = () => {};
  let reset = async () => next;
  const flow = createRecoveryMasterCoordinator(() => ({
    currentVault: () => current, getActiveVaultId: () => active, getAccountEmail: () => account,
    passwordsCollide: () => collide,
    captureVaultLiveness: (vault) => captureVaultLiveness(vault, () => epoch, () => current),
    replaceUnlockedVault: (value) => { current = value; onReplace(); }, publish: (value) => { offer = value; onPublish(); },
  }), async (_vault, options) => { calls++; resetLiveness = options.liveness; return reset(); });
  return { old, next, flow, current: () => current, offer: () => offer, calls: () => calls,
    collide: () => { collide = true; },
    expire: () => { epoch++; },
    resetLiveness: () => resetLiveness,
    onPersist: (callback: () => void) => { persist = callback; },
    onPublish: (callback: () => void) => { onPublish = callback; },
    onReplace: (callback: () => void) => { onReplace = callback; },
    setCurrent: (value: UnlockedVault | null) => { current = value; },
    setActive: (value: string) => { active = value; },
    setAccount: () => { account = "other@example.invalid"; },
    hold: () => { let resolve!: (value: UnlockedVault) => void;
      const promise = new Promise<UnlockedVault>((yes) => { resolve = yes; }); reset = () => promise; return resolve; },
    rejectLater: () => { let reject!: (error: Error) => void;
      const promise = new Promise<UnlockedVault>((_yes, no) => { reject = no; }); reset = () => promise; return reject; },
    fail: () => { reset = async () => { throw new Error("synthetic CAS409"); }; },
  };
}

test("immediate recovery offer and explicit completion adopt before device offer; no second write", async () => {
  const f = fixture();
  f.flow.begin(f.old);
  assert.deepEqual(f.offer(), { vaultId: f.old.vaultId, stage: "password", busy: false });
  await f.flow.complete("synthetic-new", "synthetic-kit");
  assert.equal(f.current(), f.next);
  assert.deepEqual(f.offer(), { vaultId: f.old.vaultId, stage: "devices", busy: false });
  await assert.rejects(f.flow.complete("synthetic-new", "synthetic-kit"), /recovery_context_required/);
  assert.equal(f.calls(), 1);
  f.flow.clear();
  assert.equal(f.offer(), null);
});

test("existing master/device unlock is not a recovery offer", () => {
  const f = fixture();
  f.old.unlockedWith = "master_password";
  f.flow.begin(f.old);
  assert.equal(f.offer(), null);
  assert.equal(f.calls(), 0);
});

test("dismissal and device-navigation intent cause no write", () => {
  const f = fixture();
  f.flow.begin(f.old); f.flow.clear();
  assert.equal(f.offer(), null);
  assert.equal(f.calls(), 0);
});

test("same account password is rejected exactly like Create before resetting", async () => {
  const f = fixture();
  f.flow.begin(f.old); f.collide();
  await assert.rejects(f.flow.complete("synthetic-account", "synthetic-kit"), /passwords_must_differ/);
  assert.equal(f.calls(), 0);
  assert.equal(f.offer()?.busy, false);
});

test("double submit does not create a second write", async () => {
  const f = fixture();
  const resolve = f.hold(); f.flow.begin(f.old);
  const first = f.flow.complete("synthetic-new", "synthetic-kit");
  await assert.rejects(f.flow.complete("synthetic-new", "synthetic-kit"), /recovery_context_required/);
  resolve(f.next); await first;
  assert.equal(f.calls(), 1);
});

test("failed reset leaves current vault and a retryable nonbusy offer", async () => {
  const f = fixture(); f.flow.begin(f.old); f.fail();
  await assert.rejects(f.flow.complete("synthetic-new", "synthetic-kit"), /CAS409/);
  assert.equal(f.current(), f.old);
  assert.equal(f.offer()?.stage, "password");
  assert.equal(f.offer()?.busy, false);
});

test("clear/account change/lock/switch cannot adopt a late result or wipe another key", async () => {
  for (const change of ["clear", "account", "lock", "switch"]) {
    const f = fixture(); const resolve = f.hold(); f.flow.begin(f.old);
    const operation = f.flow.complete("synthetic-new", "synthetic-kit");
    if (change === "clear") f.flow.clear();
    if (change === "account") f.setAccount();
    if (change === "lock") f.setCurrent(null);
    if (change === "switch") { f.setCurrent({ ...f.old, vaultId: "another-vault", vaultKey: new Uint8Array(32).fill(9) }); f.setActive("another-vault"); }
    f.flow.sync(); resolve(f.next); await operation;
    assert.notEqual(f.current(), f.next);
    assert.equal(f.offer(), null);
    assert.ok(f.next.vaultKey.every((b) => b === 0));
    if (change === "switch") assert.ok(f.current()!.vaultKey.every((b) => b === 9));
  }
});

test("same-ID replacement invalidates the old reference and offer", async () => {
  const f = fixture(); f.flow.begin(f.old);
  f.setCurrent({ ...f.old }); f.flow.sync();
  assert.equal(f.flow.isCurrent(), false);
  assert.equal(f.offer(), null);
  await assert.rejects(f.flow.complete("synthetic-new", "synthetic-kit"), /recovery_context_required/);
  assert.equal(f.calls(), 0);
});


test("pending save failure preserves next, retries locally, and never resets consumed old", async () => {
  const f = fixture(); f.flow.begin(f.old);
  const failure = new Error("synthetic storage refusal");
  f.onPersist(() => { throw failure; });
  await assert.rejects(f.flow.complete("synthetic-new", "synthetic-kit"), (e) => e === failure);
  assert.equal(f.current(), f.old);
  assert.equal(f.offer()?.pendingAdoption, true);
  assert.equal(f.offer()?.busy, false);
  assert.ok(f.next.vaultKey.some((b) => b !== 0));
  f.flow.begin(f.old);
  assert.equal(f.offer()?.pendingAdoption, true);
  await assert.rejects(f.flow.complete("different-password", "different-kit"), /recovery_context_required/);
  await assert.rejects(f.flow.retryAdoption(), (e) => e === failure);
  assert.equal(f.calls(), 1);
  f.onPersist(() => {});
  await f.flow.retryAdoption();
  assert.equal(f.current(), f.next);
  assert.equal(f.offer()?.stage, "devices");
  assert.equal(f.offer()?.pendingAdoption, undefined);
  f.flow.clear();
  assert.ok(f.next.vaultKey.some((b) => b !== 0), "clear never wipes an adopted key");
  f.setCurrent(f.old); f.flow.begin(f.old);
  await assert.rejects(f.flow.complete("synthetic-new", "synthetic-kit"), /recovery_context_required/);
  assert.equal(f.calls(), 1);
});

for (const change of ["clear", "account", "lock", "switch", "same-id", "epoch"]) {
  test(`pending ${change} zeroizes only owned next and refuses retry`, async () => {
    const f = fixture(); f.flow.begin(f.old);
    f.onPersist(() => { throw new Error("synthetic storage refusal"); });
    await assert.rejects(f.flow.complete("synthetic-new", "synthetic-kit"));
    if (change === "clear") f.flow.clear();
    if (change === "account") f.setAccount();
    if (change === "lock") f.setCurrent(null);
    if (change === "epoch") f.expire();
    if (change === "switch" || change === "same-id") {
      f.setCurrent({ ...f.old, vaultId: change === "switch" ? "another-vault" : f.old.vaultId, vaultKey: new Uint8Array(32).fill(9) });
      if (change === "switch") f.setActive("another-vault");
    }
    f.flow.sync();
    assert.ok(f.next.vaultKey.every((b) => b === 0));
    assert.equal(f.offer(), null);
    await assert.rejects(f.flow.retryAdoption(), /recovery_context_required/);
    assert.equal(f.calls(), 1);
    if (change === "switch" || change === "same-id") assert.ok(f.current()!.vaultKey.every((b) => b === 9));
  });
}

test("storage callback invalidation cannot adopt or overwrite a new offer", async () => {
  const f = fixture(); f.flow.begin(f.old);
  const newer = { ...f.old, vaultId: "newer-vault", vaultKey: new Uint8Array(32).fill(9) };
  f.onPersist(() => {
    f.setCurrent(newer); f.setActive(newer.vaultId); f.flow.begin(newer);
  });
  await f.flow.complete("synthetic-new", "synthetic-kit");
  assert.equal(f.current(), newer);
  assert.deepEqual(f.offer(), { vaultId: newer.vaultId, stage: "password", busy: false });
  assert.ok(f.next.vaultKey.every((b) => b === 0));
  assert.ok(newer.vaultKey.every((b) => b === 9));
});

test("stale reset result cannot reset a newer offer and publish clear before reset sends nothing", async () => {
  const f = fixture(); const resolve = f.hold(); f.flow.begin(f.old);
  const work = f.flow.complete("synthetic-new", "synthetic-kit");
  const newer = { ...f.old, vaultKey: new Uint8Array(32).fill(9) };
  f.setCurrent(newer); f.flow.begin(newer);
  resolve(f.next); await work;
  assert.equal(f.current(), newer);
  assert.equal(f.offer()?.busy, false);
  assert.ok(f.next.vaultKey.every((b) => b === 0));
  const g = fixture(); g.flow.begin(g.old);
  g.onPublish(() => { if (g.offer()?.busy) g.flow.clear(); });
  await g.flow.complete("synthetic-new", "synthetic-kit");
  assert.equal(g.calls(), 0);
  assert.equal(g.offer(), null);
});


test("late reset rejection cannot clear or republish over a new generation", async () => {
  const f = fixture(); const reject = f.rejectLater(); f.flow.begin(f.old);
  const work = f.flow.complete("synthetic-new", "synthetic-kit");
  const newer = { ...f.old, vaultKey: new Uint8Array(32).fill(9) };
  f.setCurrent(newer); f.flow.begin(newer);
  const offer = f.offer();
  reject(new Error("synthetic old reset failure"));
  await work;
  assert.equal(f.current(), newer);
  assert.equal(f.offer(), offer, "old catch/finally cannot publish into the new generation");
  assert.ok(newer.vaultKey.every((b) => b === 9));
});


test("reset receives the original captured liveness through to its effect boundary", async () => {
  const f = fixture(); const resolve = f.hold(); f.flow.begin(f.old);
  const work = f.flow.complete("synthetic-new", "synthetic-kit");
  const live = f.resetLiveness();
  assert.ok(live, "reset must receive the captured VaultLiveness");
  assert.equal(live.epoch, 0);
  assert.equal(live.isLive(), true);
  f.expire();
  assert.equal(live.isLive(), false);
  resolve(f.next); await work;
  assert.notEqual(f.current(), f.next);
  assert.ok(f.next.vaultKey.every((b) => b === 0));
});
