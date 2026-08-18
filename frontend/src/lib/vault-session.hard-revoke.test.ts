/**
 * hardRevokeDevice: VK rotation, omit target, CAS before DELETE.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  deriveMasterKey,
  deriveRecoveryWrappingKey,
  formatRecoveryKey,
  generateRecoveryKey,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  wrapVaultKey,
} from "@4allpass/crypto";

import { api, ApiError } from "./api.ts";
import {
  CommitConflict,
  hardRevokeDevice,
  type UnlockedVault,
} from "./vault-session.ts";

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

Object.defineProperty(globalThis, "sessionStorage", {
  configurable: true,
  value: {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
  },
});

const PASSWORD = "hard-revoke-master-password";
const TARGET = "dev_target_device_aaaaaaaa";
const SELF = "dev_self_device_bbbbbbbbbb";
const profile = ARGON2ID_PROFILES.mobile_safe;

const originalCommit = api.commitSnapshot.bind(api);
const originalRevoke = api.revokeDevice.bind(api);

afterEach(() => {
  memory.clear();
  api.commitSnapshot = originalCommit;
  api.revokeDevice = originalRevoke;
});

function buildUnlocked(): { vault: UnlockedVault; recoveryKeyText: string } {
  memory.set("4allpass.deviceId", SELF);
  const vaultId = "vault-hard-revoke-test-1";
  const vaultKey = generateVaultKey();
  const salt = generateSalt(16);
  const masterKey = deriveMasterKey(PASSWORD, salt, profile);
  const recoveryKey = generateRecoveryKey();
  const recoveryWrappingKey = deriveRecoveryWrappingKey({ recoveryKey, vaultId });
  const master = wrapVaultKey({
    vaultKey,
    wrappingKey: masterKey,
    vaultId,
    type: "master",
    vaultKeyVersion: 1,
    kdf: kdfParamsFrom(profile, salt),
  });
  const recovery = wrapVaultKey({
    vaultKey,
    wrappingKey: recoveryWrappingKey,
    vaultId,
    type: "recovery",
    vaultKeyVersion: 1,
  });
  const target = wrapVaultKey({
    vaultKey,
    wrappingKey: generateVaultKey(), // stand-in DK; only presence matters for omit check
    vaultId,
    type: "device",
    vaultKeyVersion: 1,
    deviceId: TARGET,
    deviceKeyVersion: 1,
  });
  const vault: UnlockedVault = {
    vaultId,
    revision: 1,
    vaultKeyVersion: 1,
    vaultKey,
    envelopes: [master, recovery, target],
    entries: [
      {
        id: "entry_demo",
        title: "Demo",
        username: "u",
        password: "secret",
        url: "",
        notes: "",
        updatedAt: new Date().toISOString(),
      },
    ],
    unlockedWith: "master_password",
  };
  return { vault, recoveryKeyText: formatRecoveryKey(recoveryKey) };
}

test("hardRevokeDevice rotates VK, omits target, seals manifest, then DELETE", async () => {
  const { vault, recoveryKeyText } = buildUnlocked();
  const calls: string[] = [];
  let committedPayload: Parameters<typeof api.commitSnapshot>[1] | null = null;

  api.commitSnapshot = async (vaultId, payload) => {
    calls.push("commit");
    committedPayload = payload;
    return {
      vaultId,
      revision: payload.revision,
      vaultKeyVersion: payload.vaultKeyVersion,
      cryptoProtocolVersion: 1,
      envelopes: payload.envelopes,
      entries: payload.entries,
      sealedManifest: payload.sealedManifest,
    };
  };
  api.revokeDevice = async () => {
    calls.push("delete");
    return {
      deviceId: TARGET,
      label: "Phone",
      platform: null,
      userAgentSummary: null,
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
      revokedAt: new Date().toISOString(),
      hasDeviceEnvelope: false,
      revocation: "metadata_only",
      credentials: [],
    };
  };

  const updated = await hardRevokeDevice(vault, {
    targetDeviceId: TARGET,
    masterPassword: PASSWORD,
    recoveryKeyText,
  });

  assert.deepEqual(calls, ["commit", "delete"]);
  assert.ok(committedPayload);
  assert.equal(committedPayload.vaultKeyVersion, 2);
  assert.equal(committedPayload.revision, 2);
  assert.equal(committedPayload.expectedRevision, 1);
  assert.ok(committedPayload.sealedManifest);
  const deviceIds = committedPayload.envelopes
    .filter((env) => env.type === "device")
    .map((env) => env.deviceId);
  assert.ok(!deviceIds.includes(TARGET));
  // No local DK without ceremony → typically no device envelopes at all.
  assert.equal(deviceIds.length, 0);
  assert.ok(committedPayload.envelopes.some((env) => env.type === "master"));
  assert.ok(committedPayload.envelopes.some((env) => env.type === "recovery"));

  assert.equal(updated.vaultKeyVersion, 2);
  assert.equal(updated.revision, 2);
  assert.ok(!updated.envelopes.some((env) => env.type === "device" && env.deviceId === TARGET));
  assert.equal(updated.entries.length, 1);
  assert.equal(updated.entries[0]?.password, "secret");
});

test("hardRevokeDevice does not DELETE when CAS returns 409", async () => {
  const { vault, recoveryKeyText } = buildUnlocked();
  const calls: string[] = [];

  api.commitSnapshot = async () => {
    calls.push("commit");
    throw new ApiError(409, { detail: "revision conflict", currentRevision: 2 });
  };
  api.revokeDevice = async () => {
    calls.push("delete");
    throw new Error("DELETE must not run after CAS failure");
  };

  await assert.rejects(
    () =>
      hardRevokeDevice(vault, {
        targetDeviceId: TARGET,
        masterPassword: PASSWORD,
        recoveryKeyText,
      }),
    (error: unknown) => error instanceof CommitConflict,
  );
  assert.deepEqual(calls, ["commit"]);
});
