import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARGON2ID_PROFILES,
  AuthFailureError,
  PRODUCTION_MEMORY_KIB_MAX,
  ProtocolError,
  bytesToHex,
  deriveDeviceWrappingKey,
  deriveMasterKey,
  deriveMasterKeyFromEnvelope,
  deriveRecoveryWrappingKey,
  generateDeviceKey,
  generateSalt,
  kdfParamsFrom,
  prfEvalFirst,
  randomBytes,
  unwrapDeviceKey,
  wrapDeviceKey,
} from "../src/index.ts";
import { C, VKV, fixtureSnapshot, kdf } from "./fixtures.ts";
import { loadJson, type DeviceSuite } from "./helpers.ts";

const device = loadJson<DeviceSuite>("device-prf-v1.json").constants;
const cred = new Uint8Array(16).fill(0xa1);
const prfOutput = new Uint8Array(32).fill(0x5a);

const dwkInput = {
  prfOutput,
  rpId: device.rp_id,
  vaultId: C.vault_id,
  deviceId: C.device_id,
  credentialId: cred,
};

describe("attack: PRF misuse", () => {
  it("refuses PRF output that is not exactly 32 bytes", () => {
    for (const length of [0, 16, 31, 33, 64]) {
      assert.throws(
        () => deriveDeviceWrappingKey({ ...dwkInput, prfOutput: new Uint8Array(length) }),
        ProtocolError,
      );
    }
  });

  it("refuses an all-zero PRF result from a non-PRF authenticator", () => {
    assert.throws(
      () => deriveDeviceWrappingKey({ ...dwkInput, prfOutput: new Uint8Array(32) }),
      ProtocolError,
    );
  });

  it("never uses the raw PRF output as a wrapping key", () => {
    const dwk = deriveDeviceWrappingKey(dwkInput);
    assert.notEqual(bytesToHex(dwk), bytesToHex(prfOutput));
    const envelope = wrapDeviceKey({
      deviceKey: generateDeviceKey(),
      deviceWrappingKey: dwk,
      vaultId: C.vault_id,
      deviceId: C.device_id,
      credentialId: cred,
      deviceKeyVersion: 1,
    });
    assert.throws(
      () =>
        unwrapDeviceKey(envelope, {
          deviceWrappingKey: prfOutput,
          vaultId: C.vault_id,
          deviceId: C.device_id,
          credentialId: cred,
          deviceKeyVersion: 1,
        }),
      AuthFailureError,
    );
  });

  it("binds the PRF evaluation input to the RP and the vault", () => {
    const base = bytesToHex(prfEvalFirst(device.rp_id, C.vault_id));
    assert.equal(prfEvalFirst(device.rp_id, C.vault_id).length, 32);
    assert.notEqual(bytesToHex(prfEvalFirst("evil.example", C.vault_id)), base);
    assert.notEqual(bytesToHex(prfEvalFirst(device.rp_id, "vault_OTHER")), base);
  });

  it("refuses empty identifiers in the PRF context", () => {
    assert.throws(() => prfEvalFirst("", C.vault_id), ProtocolError);
    assert.throws(() => prfEvalFirst(device.rp_id, ""), ProtocolError);
    assert.throws(() => deriveDeviceWrappingKey({ ...dwkInput, deviceId: "" }), ProtocolError);
  });
});

describe("attack: HKDF misuse", () => {
  it("separates every context field", () => {
    const base = bytesToHex(deriveDeviceWrappingKey(dwkInput));
    const variants = [
      { ...dwkInput, rpId: "other.example" },
      { ...dwkInput, vaultId: "vault_OTHER" },
      { ...dwkInput, deviceId: "dev_other" },
      { ...dwkInput, credentialId: new Uint8Array(16).fill(0xb2) },
      { ...dwkInput, prfOutput: new Uint8Array(32).fill(0x5b) },
    ];
    const seen = new Set([base]);
    for (const variant of variants) {
      const derived = bytesToHex(deriveDeviceWrappingKey(variant));
      assert.equal(seen.has(derived), false);
      seen.add(derived);
    }
  });

  it("keeps the device and recovery derivations in different domains", () => {
    const shared = new Uint8Array(32).fill(0x5a);
    const dwk = deriveDeviceWrappingKey({ ...dwkInput, prfOutput: shared });
    const rwk = deriveRecoveryWrappingKey({ recoveryKey: shared, vaultId: C.vault_id });
    assert.notEqual(bytesToHex(dwk), bytesToHex(rwk));
    assert.notEqual(bytesToHex(rwk), bytesToHex(shared));
  });

  it("binds the recovery wrapping key to the vault", () => {
    const recoveryKey = randomBytes(32);
    const a = deriveRecoveryWrappingKey({ recoveryKey, vaultId: C.vault_id });
    const b = deriveRecoveryWrappingKey({ recoveryKey, vaultId: "vault_OTHER" });
    assert.notEqual(bytesToHex(a), bytesToHex(b));
  });
});

describe("attack: KDF parameter downgrade", () => {
  it("refuses a production vault below the memory floor", () => {
    assert.throws(
      () => deriveMasterKey("pw", generateSalt(), ARGON2ID_PROFILES.ci),
      ProtocolError,
    );
  });

  it("refuses a hostile envelope that asks for a weak KDF", () => {
    const { master } = fixtureSnapshot();
    const kdfBlock = master.kdf;
    assert.ok(kdfBlock);
    const weak = { ...master, kdf: { ...kdfBlock, memory: 8, iterations: 1, parallelism: 1 } };
    assert.throws(() => deriveMasterKeyFromEnvelope("pw", weak), ProtocolError);
  });

  it("refuses a hostile envelope that asks for an absurd amount of memory", () => {
    const { master } = fixtureSnapshot();
    const kdfBlock = master.kdf;
    assert.ok(kdfBlock);
    for (const memory of [PRODUCTION_MEMORY_KIB_MAX + 1, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
      const bomb = { ...master, kdf: { ...kdfBlock, memory } };
      assert.throws(() => deriveMasterKeyFromEnvelope("pw", bomb), ProtocolError);
    }
  });

  it("refuses out-of-range iteration and lane counts", () => {
    const { master } = fixtureSnapshot();
    const kdfBlock = master.kdf;
    assert.ok(kdfBlock);
    for (const params of [{ iterations: 0 }, { iterations: 1024 }, { parallelism: 0 }, { parallelism: 4096 }]) {
      assert.throws(
        () => deriveMasterKeyFromEnvelope("pw", { ...master, kdf: { ...kdfBlock, ...params } }),
        ProtocolError,
      );
    }
  });

  it("refuses another Argon2 variant, version or output length", () => {
    const { master } = fixtureSnapshot();
    const kdfBlock = master.kdf;
    assert.ok(kdfBlock);
    const variants = [{ algorithm: "argon2i" }, { version: 0x10 }, { hashLen: 16 }] as const;
    for (const params of variants) {
      assert.throws(
        () =>
          deriveMasterKeyFromEnvelope("pw", {
            ...master,
            kdf: { ...kdfBlock, ...params } as never,
          }),
        ProtocolError,
      );
    }
  });

  it("refuses a salt of the wrong size", () => {
    const { master } = fixtureSnapshot();
    const kdfBlock = master.kdf;
    assert.ok(kdfBlock);
    for (const length of [0, 8, 15, 24, 33]) {
      assert.throws(
        () =>
          deriveMasterKeyFromEnvelope("pw", {
            ...master,
            kdf: { ...kdfBlock, salt: new Uint8Array(length) },
          }),
        ProtocolError,
      );
    }
    assert.throws(() => generateSalt(8 as never), ProtocolError);
    assert.throws(() => kdfParamsFrom(ARGON2ID_PROFILES.standard, new Uint8Array(8)), ProtocolError);
  });

  it("still derives the same key for the pinned test profile when the caller opts in", () => {
    const salt = new Uint8Array(16).fill(1);
    const a = deriveMasterKey("pw", salt, ARGON2ID_PROFILES.ci, { allowTestProfile: true });
    const b = deriveMasterKey("pw", salt, ARGON2ID_PROFILES.ci, { allowTestProfile: true });
    assert.equal(bytesToHex(a), bytesToHex(b));
    assert.equal(a.length, 32);
  });

  it("refuses to open a ci-profile envelope on a production path", () => {
    const { master } = fixtureSnapshot();
    assert.equal(kdf.memory, ARGON2ID_PROFILES.ci.memory);
    assert.throws(() => deriveMasterKeyFromEnvelope("pw", master), ProtocolError);
    assert.equal(
      deriveMasterKeyFromEnvelope("pw", master, { allowTestProfile: true }).length,
      32,
    );
    assert.equal(master.vaultKeyVersion, VKV);
  });
});
