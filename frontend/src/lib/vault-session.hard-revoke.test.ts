/**
 * hardRevokeDevice: VK rotation, omit target, CAS before DELETE.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  bytesToBase64,
  deriveMasterKey,
  deriveRecoveryWrappingKey,
  encodeDeviceKeyEnvelope,
  formatRecoveryKey,
  generateDeviceKey,
  generateRecoveryKey,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  wrapDeviceKey,
  wrapVaultKey,
} from "@4allpass/crypto";
import { memoryDeviceUnlockStore } from "@4allpass/webauthn";

import { api, ApiError } from "./api.ts";
import { setSnapshotCacheForTests } from "./snapshot-cache.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import {
  CommitConflict,
  hardRevokeDevice,
  setDeviceUnlockStoreForTests,
  type UnlockedVault,
} from "./vault-session.ts";

const PASSWORD = "hard-revoke-master-password";
const TARGET = "dev_target_device_aaaaaaaa";
const SELF = "dev_self_device_bbbbbbbbbb";
const CREDENTIAL_ID = new Uint8Array(16).fill(7);
const profile = ARGON2ID_PROFILES.mobile_safe;

const originalCommit = api.commitSnapshot.bind(api);
const originalRevoke = api.revokeDevice.bind(api);

afterEach(() => {
  clearTestStorage();
  setDeviceUnlockStoreForTests(null);
  setSnapshotCacheForTests(null);
  api.commitSnapshot = originalCommit;
  api.revokeDevice = originalRevoke;
});

function mockApis(): {
  calls: string[];
  committedPayload: { current: Parameters<typeof api.commitSnapshot>[1] | null };
} {
  const calls: string[] = [];
  const committedPayload: { current: Parameters<typeof api.commitSnapshot>[1] | null } = {
    current: null,
  };
  api.commitSnapshot = async (vaultId, payload) => {
    calls.push("commit");
    committedPayload.current = payload;
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
  return { calls, committedPayload };
}

function buildUnlocked(options?: {
  includeSelfDevice?: boolean;
  deviceKey?: Uint8Array;
}): { vault: UnlockedVault; recoveryKeyText: string; deviceKey: Uint8Array } {
  localStorage.setItem("4allpass.deviceId", SELF);
  const vaultId = "vault-hard-revoke-test-1";
  const vaultKey = generateVaultKey();
  const salt = generateSalt(16);
  const masterKey = deriveMasterKey(PASSWORD, salt, profile);
  const recoveryKey = generateRecoveryKey();
  const recoveryWrappingKey = deriveRecoveryWrappingKey({ recoveryKey, vaultId });
  const deviceKey = options?.deviceKey ?? generateDeviceKey();
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
  const envelopes = [master, recovery, target];
  if (options?.includeSelfDevice) {
    envelopes.push(
      wrapVaultKey({
        vaultKey,
        wrappingKey: deviceKey,
        vaultId,
        type: "device",
        vaultKeyVersion: 1,
        deviceId: SELF,
        deviceKeyVersion: 1,
      }),
    );
  }
  const vault: UnlockedVault = {
    vaultId,
    revision: 1,
    vaultKeyVersion: 1,
    vaultKey,
    envelopes,
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
  return { vault, recoveryKeyText: formatRecoveryKey(recoveryKey), deviceKey };
}

async function seedLocalDeviceStore(vaultId: string, deviceKey: Uint8Array): Promise<void> {
  const wrappingKey = generateDeviceKey();
  const deviceKeyEnvelope = wrapDeviceKey({
    deviceKey,
    deviceWrappingKey: wrappingKey,
    vaultId,
    deviceId: SELF,
    credentialId: CREDENTIAL_ID,
    deviceKeyVersion: 1,
  });
  const store = memoryDeviceUnlockStore([
    {
      vaultId,
      deviceId: SELF,
      rpId: "localhost",
      credentialId: bytesToBase64(CREDENTIAL_ID),
      mechanism: "uv_gated_local",
      deviceKeyVersion: 1,
      deviceKeyEnvelope: encodeDeviceKeyEnvelope(deviceKeyEnvelope),
      wrappingKey: bytesToBase64(wrappingKey),
      createdAt: new Date().toISOString(),
    },
  ]);
  setDeviceUnlockStoreForTests(store);
}

test("hardRevokeDevice rotates VK, omits target, seals manifest, then DELETE", async () => {
  const { vault, recoveryKeyText } = buildUnlocked();
  const { calls, committedPayload } = mockApis();

  const updated = await hardRevokeDevice(vault, {
    targetDeviceId: TARGET,
    masterPassword: PASSWORD,
    recoveryKeyText,
  });

  assert.deepEqual(calls, ["commit", "delete"]);
  assert.ok(committedPayload.current);
  assert.equal(committedPayload.current.vaultKeyVersion, 2);
  assert.equal(committedPayload.current.revision, 2);
  assert.equal(committedPayload.current.expectedRevision, 1);
  assert.ok(committedPayload.current.sealedManifest);
  const deviceIds = committedPayload.current.envelopes
    .filter((env) => env.type === "device")
    .map((env) => env.deviceId);
  assert.ok(!deviceIds.includes(TARGET));
  // No local DK without ceremony → typically no device envelopes at all.
  assert.equal(deviceIds.length, 0);
  assert.ok(committedPayload.current.envelopes.some((env) => env.type === "master"));
  assert.ok(committedPayload.current.envelopes.some((env) => env.type === "recovery"));

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

test("hardRevokeDevice includes local device envelope when uv_gated_local and entitled", async () => {
  const { vault, recoveryKeyText, deviceKey } = buildUnlocked({ includeSelfDevice: true });
  await seedLocalDeviceStore(vault.vaultId, deviceKey);
  const { calls, committedPayload } = mockApis();

  await hardRevokeDevice(vault, {
    targetDeviceId: TARGET,
    masterPassword: PASSWORD,
    recoveryKeyText,
  });

  assert.deepEqual(calls, ["commit", "delete"]);
  assert.ok(committedPayload.current);
  const deviceIds = committedPayload.current.envelopes
    .filter((env) => env.type === "device")
    .map((env) => env.deviceId);
  assert.deepEqual(deviceIds, [SELF]);
  assert.ok(!deviceIds.includes(TARGET));
  assert.equal(committedPayload.current.vaultKeyVersion, 2);
});

test("hardRevokeDevice does not rewrap when self envelope absent despite local DK", async () => {
  const { vault, recoveryKeyText, deviceKey } = buildUnlocked({ includeSelfDevice: false });
  await seedLocalDeviceStore(vault.vaultId, deviceKey);
  const { committedPayload } = mockApis();

  await hardRevokeDevice(vault, {
    targetDeviceId: TARGET,
    masterPassword: PASSWORD,
    recoveryKeyText,
  });

  assert.ok(committedPayload.current);
  const deviceIds = committedPayload.current.envelopes
    .filter((env) => env.type === "device")
    .map((env) => env.deviceId);
  assert.equal(deviceIds.length, 0);
});
