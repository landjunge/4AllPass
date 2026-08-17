import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARGON2ID_PROFILES,
  PRODUCTION_MEMORY_KIB_MAX,
  ProtocolError,
  assertKdfUpperBounds,
  assertProductionKdf,
  deriveMasterKeyFromEnvelope,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  randomBytes,
  wrapVaultKey,
} from "../src/index.ts";
import type { Argon2idParams } from "../src/index.ts";

const base: Argon2idParams = {
  algorithm: "argon2id",
  version: 0x13,
  memory: 65_536,
  iterations: 3,
  parallelism: 4,
  hashLen: 32,
};

describe("assertProductionKdf floors (M1)", () => {
  it("accepts every documented production profile", () => {
    for (const name of ["mobile_safe", "balanced", "standard", "high"] as const) {
      assertProductionKdf(ARGON2ID_PROFILES[name]);
    }
  });

  it("rejects iterations below the floor even when memory is fine", () => {
    assert.throws(() => assertProductionKdf({ ...base, iterations: 1 }), ProtocolError);
  });

  it("rejects parallelism below the floor even when memory is fine", () => {
    assert.throws(() => assertProductionKdf({ ...base, parallelism: 0 }), ProtocolError);
  });
});

describe("KDF upper bounds — resource-exhaustion guard (M2)", () => {
  it("rejects excessive memory", () => {
    assert.throws(
      () => assertKdfUpperBounds({ ...base, memory: PRODUCTION_MEMORY_KIB_MAX + 1 }),
      ProtocolError,
    );
  });

  it("rejects excessive iterations", () => {
    assert.throws(() => assertKdfUpperBounds({ ...base, iterations: 1000 }), ProtocolError);
  });

  it("rejects excessive parallelism", () => {
    assert.throws(() => assertKdfUpperBounds({ ...base, parallelism: 1000 }), ProtocolError);
  });

  it("accepts the strongest documented profile", () => {
    assertKdfUpperBounds(ARGON2ID_PROFILES.high);
  });
});

describe("deriveMasterKeyFromEnvelope validates untrusted kdf params", () => {
  function masterEnvelope() {
    return wrapVaultKey({
      vaultKey: generateVaultKey(),
      wrappingKey: randomBytes(32),
      vaultId: "v",
      type: "master",
      vaultKeyVersion: 1,
      kdf: kdfParamsFrom(ARGON2ID_PROFILES.ci, generateSalt()),
      allowTestProfile: true,
    });
  }

  it("refuses a weaponized (huge memory) envelope before deriving", () => {
    const env = masterEnvelope();
    assert.ok(env.kdf);
    const tampered = { ...env, kdf: { ...env.kdf, memory: PRODUCTION_MEMORY_KIB_MAX * 100 } };
    assert.throws(() => deriveMasterKeyFromEnvelope("pw", tampered), ProtocolError);
  });

  it("refuses a below-floor (ci) envelope unless a test profile is explicitly allowed", () => {
    const env = masterEnvelope();
    assert.throws(() => deriveMasterKeyFromEnvelope("pw", env), ProtocolError);
    // allowTestProfile relaxes the floor but still runs (and enforces upper bounds)
    const mk = deriveMasterKeyFromEnvelope("pw", env, { allowTestProfile: true });
    assert.equal(mk.length, 32);
  });

  it("upper bounds still apply even with allowTestProfile", () => {
    const env = masterEnvelope();
    assert.ok(env.kdf);
    const tampered = { ...env, kdf: { ...env.kdf, memory: PRODUCTION_MEMORY_KIB_MAX * 100 } };
    assert.throws(
      () => deriveMasterKeyFromEnvelope("pw", tampered, { allowTestProfile: true }),
      ProtocolError,
    );
  });
});
