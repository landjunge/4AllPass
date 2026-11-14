import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { IntegrityError, ProtocolError, RollbackError, bytesToBase64, randomBytes, type VaultRevision } from "@4allpass/crypto";

import { loadPin, savePin } from "./revision-pin.ts";

const memory = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem(key: string) {
      return memory.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
    },
    removeItem(key: string) {
      memory.delete(key);
    },
  },
});

afterEach(() => memory.clear());

test("round-trips a pin including the verified manifest digest", () => {
  const digest = randomBytes(32);
  savePin({
    vaultId: "vault-1",
    revision: 4,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1,
    manifestDigest: digest,
  });
  const loaded = loadPin("vault-1");
  assert.ok(loaded);
  assert.equal(loaded.revision, 4);
  assert.deepEqual(loaded.manifestDigest, digest);
  const raw = JSON.parse(memory.get("4allpass.pin.vault-1") ?? "{}") as { manifestDigest?: string };
  assert.equal(raw.manifestDigest, bytesToBase64(digest));
});

test("loads a legacy pin that has no manifest digest", () => {
  memory.set(
    "4allpass.pin.vault-2",
    JSON.stringify({ vaultId: "vault-2", revision: 1, vaultKeyVersion: 1 }),
  );
  const loaded = loadPin("vault-2");
  assert.ok(loaded);
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.manifestDigest, undefined);
  assert.equal(loaded.cryptoProtocolVersion, 1);
});

const v2 = { cryptoProtocolVersion: 2 };
function v2Pin(): VaultRevision {
  return { vaultId: "vault-v2", revision: 4, vaultKeyVersion: 3, ...v2, manifestDigest: randomBytes(32) };
}

test("v2 persistence requires opt-in and retains the exact protocol/digest", () => {
  const pin = v2Pin();
  assert.throws(() => savePin(pin), ProtocolError);
  assert.equal(memory.size, 0);
  savePin(pin, v2);
  const raw = memory.get("4allpass.pin.vault-v2");
  assert.ok(raw);
  assert.equal(JSON.parse(raw).cryptoProtocolVersion, 2);
  assert.throws(() => loadPin(pin.vaultId), ProtocolError);
  assert.equal(memory.get("4allpass.pin.vault-v2"), raw);
  assert.deepEqual(loadPin(pin.vaultId, v2), pin);
});

test("stored explicit invalid versions are errors, never absence or implicit v1", () => {
  for (const version of [null, 0, 3, -1, 1.5, "2", true, {}]) {
    const key = "4allpass.pin.vault-v2";
    const raw = JSON.stringify({ ...v2Pin(), cryptoProtocolVersion: version, manifestDigest: bytesToBase64(randomBytes(32)) });
    memory.set(key, raw);
    assert.throws(() => loadPin("vault-v2"), ProtocolError);
    assert.throws(() => loadPin("vault-v2", v2), ProtocolError);
    assert.throws(() => savePin(v2Pin(), v2), ProtocolError);
    assert.equal(memory.get(key), raw);
  }
});

test("v2 requires a digest on load/save; malformed explicit v1 digests also refuse", () => {
  for (const cryptoProtocolVersion of [1, 2]) {
    const options = { cryptoProtocolVersion };
    const key = "4allpass.pin.vault-v2";
    for (const manifestDigest of ["", "not-base64", bytesToBase64(new Uint8Array(31)), null, 3]) {
      const raw = JSON.stringify({ ...v2Pin(), cryptoProtocolVersion, manifestDigest });
      memory.set(key, raw);
      assert.throws(() => loadPin("vault-v2", options), ProtocolError);
      assert.equal(memory.get(key), raw);
    }
    memory.clear();
    assert.throws(() => savePin({ ...v2Pin(), cryptoProtocolVersion, manifestDigest: new Uint8Array(31) }, options), ProtocolError);
    assert.equal(memory.size, 0);
  }
  const { manifestDigest: _digest, ...withoutDigest } = v2Pin();
  assert.throws(() => savePin(withoutDigest, v2), ProtocolError);
  memory.set("4allpass.pin.vault-v2", JSON.stringify(withoutDigest));
  assert.throws(() => loadPin("vault-v2", v2), ProtocolError);
});

test("neither protocol transition overwrites an existing pin, even at higher counters", () => {
  const two = v2Pin();
  const one = { ...two, cryptoProtocolVersion: 1 };
  savePin(one);
  const rawOne = memory.get("4allpass.pin.vault-v2");
  assert.throws(() => savePin({ ...two, revision: 100, vaultKeyVersion: 100 }, v2), ProtocolError);
  assert.equal(memory.get("4allpass.pin.vault-v2"), rawOne);
  memory.clear();
  savePin(two, v2);
  const rawTwo = memory.get("4allpass.pin.vault-v2");
  assert.throws(() => savePin({ ...one, revision: 100, vaultKeyVersion: 100 }), ProtocolError);
  assert.equal(memory.get("4allpass.pin.vault-v2"), rawTwo);
});

test("only absent storage is null; broken stored pins remain intact and refuse overwrite", () => {
  assert.equal(loadPin("vault-v2"), null);
  for (const raw of ["", "{", "null", "[]", JSON.stringify({ vaultId: "foreign", revision: 1, vaultKeyVersion: 1 })]) {
    memory.set("4allpass.pin.vault-v2", raw);
    assert.throws(() => loadPin("vault-v2"), ProtocolError);
    assert.throws(() => savePin({ ...v2Pin(), cryptoProtocolVersion: 1 }), ProtocolError);
    assert.equal(memory.get("4allpass.pin.vault-v2"), raw);
  }
});

test("legacy field omission stays v1; explicit v2 never adopts it as v2", () => {
  const raw = JSON.stringify({ vaultId: "vault-v2", revision: 1, vaultKeyVersion: 1 });
  memory.set("4allpass.pin.vault-v2", raw);
  assert.equal(loadPin("vault-v2")?.cryptoProtocolVersion, 1);
  assert.throws(() => loadPin("vault-v2", v2), ProtocolError);
  assert.equal(memory.get("4allpass.pin.vault-v2"), raw);
});

test("changing option getters cannot authorize a protocol overwrite", () => {
  const two = v2Pin();
  savePin({ ...two, cryptoProtocolVersion: 1 });
  const before = memory.get("4allpass.pin.vault-v2");
  let reads = 0;
  const options = { get cryptoProtocolVersion() { return ++reads === 1 ? 2 : 1; } };
  assert.throws(() => savePin(two, options), ProtocolError);
  assert.equal(reads, 1);
  assert.equal(memory.get("4allpass.pin.vault-v2"), before);
  memory.clear();
  reads = 0;
  savePin(two, options);
  assert.equal(reads, 1);
  reads = 0;
  assert.deepEqual(loadPin(two.vaultId, options), two);
  assert.equal(reads, 1);
});

for (const cryptoProtocolVersion of [1, 2]) {
  test(`save v${cryptoProtocolVersion} preserves freshness, generation and digest pins`, () => {
    const options = { cryptoProtocolVersion };
    const pin = { ...v2Pin(), cryptoProtocolVersion };
    savePin(pin, options);
    const before = memory.get("4allpass.pin.vault-v2");
    for (const [bad, error] of [
      [{ ...pin, revision: pin.revision - 1 }, RollbackError],
      [{ ...pin, revision: pin.revision + 1, vaultKeyVersion: pin.vaultKeyVersion - 1 }, IntegrityError],
      [{ ...pin, manifestDigest: randomBytes(32) }, IntegrityError],
    ] as const) {
      assert.throws(() => savePin(bad, options), error);
      assert.equal(memory.get("4allpass.pin.vault-v2"), before);
    }
    const { manifestDigest: _digest, ...missing } = pin;
    assert.throws(() => savePin({ ...missing, revision: pin.revision + 1 }, options), cryptoProtocolVersion === 2 ? ProtocolError : IntegrityError);
    assert.equal(memory.get("4allpass.pin.vault-v2"), before);
    savePin({ ...pin }, options);
    const next = { ...pin, revision: pin.revision + 1, manifestDigest: randomBytes(32) };
    savePin(next, options);
    assert.deepEqual(loadPin(pin.vaultId, options), next);
  });
}
