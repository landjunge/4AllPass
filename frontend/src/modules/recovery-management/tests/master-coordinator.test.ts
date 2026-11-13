import "../../../lib/test-storage-shim.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { UnlockedVault } from "../../../lib/vault-session.ts";
import { createRecoveryMasterCoordinator, type RecoveryMasterOffer } from "../master-coordinator.ts";

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
  let reset = async () => next;
  const flow = createRecoveryMasterCoordinator(() => ({
    currentVault: () => current, getActiveVaultId: () => active, getAccountEmail: () => account,
    passwordsCollide: () => collide,
    replaceUnlockedVault: (value) => { current = value; }, publish: (value) => { offer = value; },
  }), async () => { calls++; return reset(); });
  return { old, next, flow, current: () => current, offer: () => offer, calls: () => calls,
    collide: () => { collide = true; },
    setCurrent: (value: UnlockedVault | null) => { current = value; },
    setActive: (value: string) => { active = value; },
    setAccount: () => { account = "other@example.invalid"; },
    hold: () => { let resolve!: (value: UnlockedVault) => void;
      const promise = new Promise<UnlockedVault>((yes) => { resolve = yes; }); reset = () => promise; return resolve; },
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
