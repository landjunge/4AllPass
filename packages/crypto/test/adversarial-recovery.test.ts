import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  IntegrityError,
  ProtocolError,
  bytesToHex,
  deriveDeviceWrappingKey,
  deriveRecoveryWrappingKey,
  formatRecoveryKey,
  generateDeviceKey,
  generateRecoveryKey,
  generateVaultKey,
  parseRecoveryKey,
  unwrapDeviceKey,
  unwrapVaultKey,
  wrapDeviceKey,
  wrapRecoveryEnvelope,
  wrapVaultKey,
} from "../src/index.ts";
import { C } from "./fixtures.ts";
import { loadJson, type DeviceSuite } from "./helpers.ts";

const device = loadJson<DeviceSuite>("device-prf-v1.json").constants;
const cred = new Uint8Array(16).fill(0xa1);
const vaultId = C.vault_id;
const otherVault = "vault_OTHERVAULT0000000000001";

function openRecovery(envelope: ReturnType<typeof wrapRecoveryEnvelope>, wrappingKey: Uint8Array, expectVaultKeyVersion = 1) {
  return unwrapVaultKey(envelope, {
    wrappingKey,
    vaultId,
    expectType: "recovery",
    expectVaultKeyVersion,
  });
}

describe("attack: malformed recovery kit", () => {
  it("refuses truncated, empty, and overlong kit strings", () => {
    const formatted = formatRecoveryKey(generateRecoveryKey());
    assert.throws(() => parseRecoveryKey(""), ProtocolError);
    assert.throws(() => parseRecoveryKey(formatted.slice(0, 20)), ProtocolError);
    assert.throws(() => parseRecoveryKey(formatted.slice(0, -6)), ProtocolError);
    assert.throws(() => parseRecoveryKey(`${formatted}-AAAAA`), ProtocolError);
    assert.throws(() => parseRecoveryKey(`${formatted}A`), ProtocolError);
  });

  it("refuses a single-character flip as a checksum failure, not as a different key", () => {
    const key = generateRecoveryKey();
    const formatted = formatRecoveryKey(key);
    const chars = formatted.replace(/-/g, "").split("");
    chars[0] = chars[0] === "2" ? "3" : "2";
    assert.throws(() => parseRecoveryKey(chars.join("")), IntegrityError);
  });
});

describe("attack: recovery / device wrapping-key substitution", () => {
  it("the same 32-byte IKM yields a DWK that cannot open a recovery envelope", () => {
    const ikm = generateRecoveryKey();
    const vaultKey = generateVaultKey();
    const envelope = wrapRecoveryEnvelope({
      reason: "create",
      vaultKey,
      recoveryKey: ikm,
      vaultId,
      vaultKeyVersion: 1,
    });
    const rwk = deriveRecoveryWrappingKey({ recoveryKey: ikm, vaultId });
    assert.deepEqual(openRecovery(envelope, rwk), vaultKey);

    const dwk = deriveDeviceWrappingKey({
      prfOutput: ikm,
      rpId: device.rp_id,
      vaultId,
      deviceId: C.device_id,
      credentialId: cred,
    });
    assert.notEqual(bytesToHex(dwk), bytesToHex(rwk));
    assert.throws(() => openRecovery(envelope, dwk), AuthFailureError);
  });

  it("an RWK cannot unwrap a Device-Key Envelope sealed under the matching DWK", () => {
    const ikm = generateRecoveryKey();
    const dwk = deriveDeviceWrappingKey({
      prfOutput: ikm,
      rpId: device.rp_id,
      vaultId,
      deviceId: C.device_id,
      credentialId: cred,
    });
    const rwk = deriveRecoveryWrappingKey({ recoveryKey: ikm, vaultId });
    const envelope = wrapDeviceKey({
      deviceKey: generateDeviceKey(),
      deviceWrappingKey: dwk,
      vaultId,
      deviceId: C.device_id,
      credentialId: cred,
      deviceKeyVersion: 1,
    });
    assert.throws(
      () =>
        unwrapDeviceKey(envelope, {
          deviceWrappingKey: rwk,
          vaultId,
          deviceId: C.device_id,
          credentialId: cred,
          deviceKeyVersion: 1,
        }),
      AuthFailureError,
    );
  });

  it("refuses a recovery envelope opened as master or device, even with the real RWK", () => {
    const recoveryKey = generateRecoveryKey();
    const vaultKey = generateVaultKey();
    const envelope = wrapRecoveryEnvelope({
      reason: "create",
      vaultKey,
      recoveryKey,
      vaultId,
      vaultKeyVersion: 1,
    });
    const rwk = deriveRecoveryWrappingKey({ recoveryKey, vaultId });
    assert.throws(
      () =>
        unwrapVaultKey(envelope, {
          wrappingKey: rwk,
          vaultId,
          expectType: "master",
          expectVaultKeyVersion: 1,
        }),
      IntegrityError,
    );
    assert.throws(
      () =>
        unwrapVaultKey(envelope, {
          wrappingKey: rwk,
          vaultId,
          expectType: "device",
          expectDeviceId: C.device_id,
          expectDeviceKeyVersion: 1,
          expectVaultKeyVersion: 1,
        }),
      IntegrityError,
    );
  });

  it("a recovery kit for vault A cannot open vault B's recovery envelope", () => {
    const recoveryKey = generateRecoveryKey();
    const vaultKey = generateVaultKey();
    const envelopeB = wrapVaultKey({
      vaultKey,
      wrappingKey: deriveRecoveryWrappingKey({ recoveryKey, vaultId: otherVault }),
      vaultId: otherVault,
      type: "recovery",
      vaultKeyVersion: 1,
    });
    assert.throws(
      () =>
        unwrapVaultKey(envelopeB, {
          wrappingKey: deriveRecoveryWrappingKey({ recoveryKey, vaultId }),
          vaultId,
          expectType: "recovery",
          expectVaultKeyVersion: 1,
        }),
      AuthFailureError,
    );
    assert.throws(
      () =>
        unwrapVaultKey(envelopeB, {
          wrappingKey: deriveRecoveryWrappingKey({ recoveryKey, vaultId }),
          vaultId: otherVault,
          expectType: "recovery",
          expectVaultKeyVersion: 1,
        }),
      AuthFailureError,
    );
  });
});

describe("attack: stolen kit after rotation", () => {
  it("the old print cannot unwrap the envelope written for compromised_rotation", () => {
    const stolen = generateRecoveryKey();
    const next = generateRecoveryKey();
    const vk1 = generateVaultKey();
    const vk2 = generateVaultKey();
    wrapRecoveryEnvelope({
      reason: "create",
      vaultKey: vk1,
      recoveryKey: stolen,
      vaultId,
      vaultKeyVersion: 1,
    });
    const rotated = wrapRecoveryEnvelope({
      reason: "compromised_rotation",
      vaultKey: vk2,
      recoveryKey: next,
      vaultId,
      vaultKeyVersion: 2,
      previousVaultKeyVersion: 1,
      previousRecoveryKey: stolen,
    });
    assert.deepEqual(
      unwrapVaultKey(rotated, {
        wrappingKey: deriveRecoveryWrappingKey({ recoveryKey: next, vaultId }),
        vaultId,
        expectType: "recovery",
        expectVaultKeyVersion: 2,
      }),
      vk2,
    );
    assert.throws(
      () =>
        unwrapVaultKey(rotated, {
          wrappingKey: deriveRecoveryWrappingKey({ recoveryKey: stolen, vaultId }),
          vaultId,
          expectType: "recovery",
          expectVaultKeyVersion: 2,
        }),
      AuthFailureError,
    );
  });

  it("trusted_replacement keeps the vault key but the old print cannot open the new envelope", () => {
    const oldKey = generateRecoveryKey();
    const newKey = generateRecoveryKey();
    const vaultKey = generateVaultKey();
    const replaced = wrapRecoveryEnvelope({
      reason: "trusted_replacement",
      vaultKey,
      recoveryKey: newKey,
      vaultId,
      vaultKeyVersion: 1,
      previousVaultKeyVersion: 1,
      previousRecoveryKey: oldKey,
    });
    assert.deepEqual(
      unwrapVaultKey(replaced, {
        wrappingKey: deriveRecoveryWrappingKey({ recoveryKey: newKey, vaultId }),
        vaultId,
        expectType: "recovery",
        expectVaultKeyVersion: 1,
      }),
      vaultKey,
    );
    assert.throws(
      () =>
        unwrapVaultKey(replaced, {
          wrappingKey: deriveRecoveryWrappingKey({ recoveryKey: oldKey, vaultId }),
          vaultId,
          expectType: "recovery",
          expectVaultKeyVersion: 1,
        }),
      AuthFailureError,
    );
  });
});
