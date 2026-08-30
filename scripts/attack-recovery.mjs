#!/usr/bin/env node
/**
 * Live attacks against @4allpass/crypto recovery (not docs).
 * Run: npx tsx scripts/attack-recovery.mjs
 */
import assert from "node:assert/strict";
import {
  AuthFailureError,
  IntegrityError,
  ProtocolError,
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
} from "../packages/crypto/src/index.ts";

const vaultId = "vault_ATTACKRECOVERY00000000001";
const otherVault = "vault_OTHERVAULT0000000000001";
const rows = [];

function row(name, fn) {
  try {
    fn();
    rows.push({ attack: name, result: "UNEXPECTED_SUCCESS" });
  } catch (err) {
    rows.push({ attack: name, result: err.constructor.name });
  }
}

const kit = generateRecoveryKey();
const printed = formatRecoveryKey(kit);
const vk = generateVaultKey();
const rwk = deriveRecoveryWrappingKey({ recoveryKey: kit, vaultId });
const envelope = wrapRecoveryEnvelope({
  reason: "create",
  vaultKey: vk,
  recoveryKey: kit,
  vaultId,
  vaultKeyVersion: 1,
});

row("empty kit", () => parseRecoveryKey(""));
row("truncated kit", () => parseRecoveryKey(printed.slice(0, 20)));
row("single-char flip", () => {
  const chars = printed.split("");
  chars[10] = chars[10] === "A" ? "B" : "A";
  parseRecoveryKey(chars.join(""));
});

row("wrapVaultKey(type=master) under RWK without kdf", () => {
  wrapVaultKey({
    vaultKey: vk,
    wrappingKey: rwk,
    vaultId,
    type: "master",
    vaultKeyVersion: 1,
  });
});

row("recovery envelope opened as master", () => {
  unwrapVaultKey(envelope, {
    wrappingKey: rwk,
    vaultId,
    expectType: "master",
    expectVaultKeyVersion: 1,
  });
});

row("kit for vault A opens vault B", () => {
  unwrapVaultKey(envelope, {
    wrappingKey: rwk,
    vaultId: otherVault,
    expectType: "recovery",
    expectVaultKeyVersion: 1,
  });
});

row("same 32-byte IKM as PRF → DWK opens recovery envelope", () => {
  const dwk = deriveDeviceWrappingKey({
    prfOutput: kit,
    rpId: "localhost",
    vaultId,
    deviceId: "device_ATTACK000000000000000001",
    credentialId: new Uint8Array(16).fill(0xa1),
  });
  unwrapVaultKey(envelope, {
    wrappingKey: dwk,
    vaultId,
    expectType: "recovery",
    expectVaultKeyVersion: 1,
  });
});

row("RWK unwraps a Device-Key envelope", () => {
  const dk = generateDeviceKey();
  const dwk = deriveDeviceWrappingKey({
    prfOutput: new Uint8Array(32).fill(7),
    rpId: "localhost",
    vaultId,
    deviceId: "device_ATTACK000000000000000001",
    credentialId: new Uint8Array(16).fill(0xa1),
  });
  const boxed = wrapDeviceKey({
    deviceKey: dk,
    deviceWrappingKey: dwk,
    vaultId,
    deviceId: "device_ATTACK000000000000000001",
    credentialId: new Uint8Array(16).fill(0xa1),
    deviceKeyVersion: 1,
  });
  unwrapDeviceKey(boxed, {
    deviceWrappingKey: rwk,
    vaultId,
    deviceId: "device_ATTACK000000000000000001",
    credentialId: new Uint8Array(16).fill(0xa1),
    deviceKeyVersion: 1,
  });
});

const rotatedVk = generateVaultKey();
const newKit = generateRecoveryKey();
const rotated = wrapRecoveryEnvelope({
  reason: "compromised_rotation",
  vaultKey: rotatedVk,
  recoveryKey: newKit,
  vaultId,
  vaultKeyVersion: 2,
  previousVaultKeyVersion: 1,
  previousRecoveryKey: kit,
});

row("stolen print after compromised_rotation", () => {
  unwrapVaultKey(rotated, {
    wrappingKey: rwk,
    vaultId,
    expectType: "recovery",
    expectVaultKeyVersion: 2,
  });
});

const honest = unwrapVaultKey(envelope, {
  wrappingKey: rwk,
  vaultId,
  expectType: "recovery",
  expectVaultKeyVersion: 1,
});
assert.equal(honest.length, 32);

console.log("attack-recovery against @4allpass/crypto");
for (const line of rows) {
  console.log(`- ${line.attack}: ${line.result}`);
}
const leaks = rows.filter((line) => line.result === "UNEXPECTED_SUCCESS");
if (leaks.length) {
  console.error("FAIL: an attack succeeded");
  process.exit(1);
}
console.log("honest kit still unwraps the original envelope: ok");
console.log("no finding (same family as adversarial-recovery.test.ts / F-29)");
