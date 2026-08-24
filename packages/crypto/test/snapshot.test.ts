import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARGON2ID_PROFILES,
  AuthFailureError,
  IntegrityError,
  encryptEntry,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  randomBytes,
  unlockSnapshot,
  verifySnapshot,
  wrapVaultKey,
} from "../src/index.ts";

const vaultId = "vault_test_snapshot";
const VKV = 1;
const DKV = 1;
const DEVICE_ID = "dev-1";

/** What `unlockSnapshot` needs to state about the caller's own device envelope. */
const deviceUnlock = {
  vaultId,
  vaultKeyVersion: VKV,
  deviceId: DEVICE_ID,
  deviceKeyVersion: DKV,
  allowTestProfile: true,
} as const;

function makeEntry(vaultKey: Uint8Array, id: string, text: string) {
  return encryptEntry({
    vaultKey,
    vaultId,
    entryId: id,
    vaultKeyVersion: VKV,
    plaintext: new TextEncoder().encode(text),
  });
}

function deviceEnvelope(vaultKey: Uint8Array, deviceKey: Uint8Array) {
  return wrapVaultKey({
    vaultKey,
    wrappingKey: deviceKey,
    vaultId,
    type: "device",
    vaultKeyVersion: VKV,
    deviceId: DEVICE_ID,
    deviceKeyVersion: DKV,
  });
}

function masterEnvelope(vaultKey: Uint8Array, masterKey: Uint8Array) {
  return wrapVaultKey({
    vaultKey,
    wrappingKey: masterKey,
    vaultId,
    type: "master",
    vaultKeyVersion: VKV,
    kdf: kdfParamsFrom(ARGON2ID_PROFILES.ci, generateSalt()),
    allowTestProfile: true,
  });
}

describe("verifySnapshot / unlockSnapshot (vault-revision.md §6)", () => {
  it("unlocks a consistent snapshot via the device envelope", () => {
    const vaultKey = generateVaultKey();
    const deviceKey = randomBytes(32);
    const env = deviceEnvelope(vaultKey, deviceKey);
    const entries = [makeEntry(vaultKey, "e1", "alpha"), makeEntry(vaultKey, "e2", "beta")];

    const result = unlockSnapshot({ ...deviceUnlock, envelope: env, wrappingKey: deviceKey, entries });

    assert.deepEqual(result.vaultKey, vaultKey);
    assert.equal(result.entries.length, 2);
    const first = result.entries[0];
    assert.ok(first);
    assert.equal(new TextDecoder().decode(first.plaintext), "alpha");
  });

  it("accepts master + device cross-check that agree on the Vault Key", () => {
    const vaultKey = generateVaultKey();
    const deviceKey = randomBytes(32);
    const masterKey = randomBytes(32);
    const env = deviceEnvelope(vaultKey, deviceKey);
    const master = masterEnvelope(vaultKey, masterKey);

    const result = unlockSnapshot({
      ...deviceUnlock,
      envelope: env,
      wrappingKey: deviceKey,
      entries: [makeEntry(vaultKey, "e1", "x")],
      crossCheckEnvelopes: [{ envelope: master, wrappingKey: masterKey }],
    });

    assert.deepEqual(result.vaultKey, vaultKey);
  });

  it("rejects a mixed snapshot: an entry sealed under a different Vault Key", () => {
    const vaultKey = generateVaultKey();
    const otherKey = generateVaultKey();
    const deviceKey = randomBytes(32);
    const env = deviceEnvelope(vaultKey, deviceKey);
    const entries = [makeEntry(vaultKey, "e1", "ok"), makeEntry(otherKey, "e2", "mixed")];

    assert.throws(
      () => unlockSnapshot({ ...deviceUnlock, envelope: env, wrappingKey: deviceKey, entries }),
      IntegrityError,
    );
  });

  it("rejects a mixed snapshot: a cross-check envelope wrapping a different Vault Key", () => {
    const vaultKey = generateVaultKey();
    const otherVaultKey = generateVaultKey();
    const masterKey = randomBytes(32);
    const master = masterEnvelope(otherVaultKey, masterKey);

    assert.throws(
      () =>
        verifySnapshot({
          vaultId,
          vaultKey,
          vaultKeyVersion: VKV,
          entries: [],
          crossCheckEnvelopes: [{ envelope: master, wrappingKey: masterKey }],
          allowTestProfile: true,
        }),
      IntegrityError,
    );
  });

  it("rejects a cross-vault entry as IntegrityError", () => {
    const vaultKey = generateVaultKey();
    const deviceKey = randomBytes(32);
    const env = deviceEnvelope(vaultKey, deviceKey);
    const foreign = encryptEntry({
      vaultKey,
      vaultId: "vault_OTHER",
      entryId: "e1",
      vaultKeyVersion: VKV,
      plaintext: new TextEncoder().encode("x"),
    });

    assert.throws(
      () =>
        unlockSnapshot({ ...deviceUnlock, envelope: env, wrappingKey: deviceKey, entries: [foreign] }),
      IntegrityError,
    );
  });

  it("refuses a device cross-check that omits caller deviceId", () => {
    const vaultKey = generateVaultKey();
    const deviceKey = randomBytes(32);
    const env = deviceEnvelope(vaultKey, deviceKey);

    assert.throws(
      () =>
        verifySnapshot({
          vaultId,
          vaultKey,
          vaultKeyVersion: VKV,
          entries: [],
          crossCheckEnvelopes: [{ envelope: env, wrappingKey: deviceKey }],
        }),
      IntegrityError,
    );
  });

  it("a wrong wrapping key surfaces as AuthFailureError, not IntegrityError", () => {
    const vaultKey = generateVaultKey();
    const deviceKey = randomBytes(32);
    const env = deviceEnvelope(vaultKey, deviceKey);

    assert.throws(
      () =>
        unlockSnapshot({ ...deviceUnlock, envelope: env, wrappingKey: randomBytes(32), entries: [] }),
      AuthFailureError,
    );
  });
});
