import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IntegrityError,
  RollbackError,
  assertFreshSnapshot,
  evaluateRevision,
  type VaultRevision,
} from "../src/index.ts";

const base: VaultRevision = {
  vaultId: "vault_01HZX4ALLPASS000000000001",
  revision: 10,
  vaultKeyVersion: 2,
  cryptoProtocolVersion: 1,
};

describe("evaluateRevision", () => {
  it("accepts first seen", () => {
    const d = evaluateRevision(null, base);
    assert.equal(d.ok, true);
    if (d.ok) assert.equal(d.action, "first_seen");
  });

  it("a first-use pin at uint32 max permanently rejects the honest later snapshot", () => {
    const poisoned: VaultRevision = { ...base, revision: 4294967295 };
    const first = evaluateRevision(null, poisoned);
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.action, "first_seen");
    const honest = evaluateRevision(poisoned, { ...base, revision: 6 });
    assert.equal(honest.ok, false);
    if (!honest.ok) {
      assert.equal(honest.action, "rollback");
      assert.ok(honest.error instanceof RollbackError);
      assert.equal(honest.error.lastSeenRevision, 4294967295);
      assert.equal(honest.error.incomingRevision, 6);
    }
  });

  it("accepts the same snapshot", () => {
    const d = evaluateRevision(base, { ...base });
    assert.equal(d.ok, true);
    if (d.ok) assert.equal(d.action, "same");
  });

  it("accepts a later revision with the same vault key", () => {
    const d = evaluateRevision(base, { ...base, revision: 11 });
    assert.equal(d.ok, true);
    if (d.ok) assert.equal(d.action, "advance");
  });

  it("accepts a rotation (revision and vaultKeyVersion increase)", () => {
    const d = evaluateRevision(base, { ...base, revision: 11, vaultKeyVersion: 3 });
    assert.equal(d.ok, true);
    if (d.ok) assert.equal(d.action, "rotation");
  });

  it("refuses a replayed older revision", () => {
    const d = evaluateRevision(base, { ...base, revision: 7 });
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.equal(d.action, "rollback");
      assert.ok(d.error instanceof RollbackError);
      assert.equal(d.error.lastSeenRevision, 10);
      assert.equal(d.error.incomingRevision, 7);
    }
  });

  it("refuses a vaultKeyVersion downgrade", () => {
    const d = evaluateRevision(base, { ...base, revision: 11, vaultKeyVersion: 1 });
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.equal(d.action, "downgrade");
      assert.ok(d.error instanceof IntegrityError);
    }
  });

  it("refuses same revision with a different vault key version", () => {
    const d = evaluateRevision(base, { ...base, vaultKeyVersion: 3 });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.action, "mismatch");
  });

  it("refuses a different vault id", () => {
    const d = evaluateRevision(base, { ...base, vaultId: "vault_OTHER" });
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.action, "mismatch");
  });

  it("assertFreshSnapshot throws on rollback", () => {
    assert.throws(() => assertFreshSnapshot(base, { ...base, revision: 1 }), RollbackError);
  });

  it("refuses an advance that drops the digest after a digest pin", () => {
    const digest = new Uint8Array(32).fill(7);
    const pinned: VaultRevision = { ...base, manifestDigest: digest };
    const d = evaluateRevision(pinned, { ...base, revision: 11 });
    assert.equal(d.ok, false);
    if (!d.ok) {
      assert.equal(d.action, "mismatch");
      assert.ok(d.error instanceof IntegrityError);
    }
  });
});
