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

function makeEntry(vaultKey: Uint8Array, id: string, text: string) {
  return encryptEntry({
    vaultKey,
    vaultId,
    entryId: id,
    plaintext: new TextEncoder().encode(text),
  });
}

function deviceEnvelope(vaultKey: Uint8Array, deviceKey: Uint8Array) {
  return wrapVaultKey({
    vaultKey,
    wrappingKey: deviceKey,
    vaultId,
    type: "device",
    deviceId: "dev-1",
  });
}

function masterEnvelope(vaultKey: Uint8Array, masterKey: Uint8Array) {
  return wrapVaultKey({
    vaultKey,
    wrappingKey: masterKey,
    vaultId,
    type: "master",
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

    const result = unlockSnapshot({ vaultId, envelope: env, wrappingKey: deviceKey, entries });

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
      vaultId,
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
      () => unlockSnapshot({ vaultId, envelope: env, wrappingKey: deviceKey, entries }),
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
          entries: [],
          crossCheckEnvelopes: [{ envelope: master, wrappingKey: masterKey }],
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
      plaintext: new TextEncoder().encode("x"),
    });

    assert.throws(
      () => unlockSnapshot({ vaultId, envelope: env, wrappingKey: deviceKey, entries: [foreign] }),
      IntegrityError,
    );
  });

  it("a wrong wrapping key surfaces as AuthFailureError, not IntegrityError", () => {
    const vaultKey = generateVaultKey();
    const deviceKey = randomBytes(32);
    const env = deviceEnvelope(vaultKey, deviceKey);

    assert.throws(
      () => unlockSnapshot({ vaultId, envelope: env, wrappingKey: randomBytes(32), entries: [] }),
      AuthFailureError,
    );
  });
});
