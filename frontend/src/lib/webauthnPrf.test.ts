import assert from "node:assert/strict";
import { test } from "node:test";

import { generateVaultKey, randomBytes } from "@4allpass/crypto";

import {
  buildDeviceRegistration,
  unlockVaultKey,
  type DeviceIdentity,
  type KeyGenerations,
} from "./webauthnPrf.ts";

const generations: KeyGenerations = { vaultKeyVersion: 1, deviceKeyVersion: 1 };

function identity(): DeviceIdentity {
  return {
    rpId: "pass.example.local",
    vaultId: "vault-1",
    deviceId: "laptop-chrome-profile-1",
    credentialId: randomBytes(32),
  };
}

test("registers a device and unlocks with the same PRF output", () => {
  const id = identity();
  const vaultKey = generateVaultKey();
  const prfOutput = randomBytes(32); // fixed 32-byte stand-in, as in device-prf-v1.json

  const envelopes = buildDeviceRegistration(id, generations, vaultKey, prfOutput.slice());
  const unlocked = unlockVaultKey(id, generations, envelopes, prfOutput.slice());

  assert.deepEqual(unlocked, vaultKey);
});

test("zeroizes the PRF output passed into registration and unlock", () => {
  const id = identity();
  const vaultKey = generateVaultKey();

  const registerPrf = randomBytes(32);
  buildDeviceRegistration(id, generations, vaultKey, registerPrf);
  assert.deepEqual(registerPrf, new Uint8Array(32));

  const envelopes = buildDeviceRegistration(id, generations, vaultKey, randomBytes(32));
  const unlockPrf = randomBytes(32);
  assert.throws(() => unlockVaultKey(id, generations, envelopes, unlockPrf));
  assert.deepEqual(unlockPrf, new Uint8Array(32));
});

test("rejects unlock with a PRF output from a different credential", () => {
  const id = identity();
  const vaultKey = generateVaultKey();
  const envelopes = buildDeviceRegistration(id, generations, vaultKey, randomBytes(32));

  const otherId = { ...id, credentialId: randomBytes(32) };
  assert.throws(() => unlockVaultKey(otherId, generations, envelopes, randomBytes(32)));
});

test("rejects unlock with a stale/incorrect PRF output for the same credential", () => {
  const id = identity();
  const vaultKey = generateVaultKey();
  const envelopes = buildDeviceRegistration(id, generations, vaultKey, randomBytes(32));

  assert.throws(() => unlockVaultKey(id, generations, envelopes, randomBytes(32)));
});
