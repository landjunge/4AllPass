/**
 * revokeDevice: omit envelope, CAS, then metadata DELETE.
 * DELETE-first on a 409 leaves the vault unable to save (422 re-attach).
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  deriveMasterKey,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  wrapVaultKey,
} from "@4allpass/crypto";

import { api, ApiError } from "./api.ts";
import { setSnapshotCacheForTests } from "./snapshot-cache.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { CommitConflict, revokeDevice, type UnlockedVault } from "./vault-session.ts";

const PASSWORD = "soft-revoke-master-password";
const TARGET = "dev_target_device_aaaaaaaa";
const profile = ARGON2ID_PROFILES.mobile_safe;

const originalCommit = api.commitSnapshot.bind(api);
const originalRevoke = api.revokeDevice.bind(api);

afterEach(() => {
  clearTestStorage();
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

function buildUnlocked(): UnlockedVault {
  const vaultId = "vault-soft-revoke-test-1";
  const vaultKey = generateVaultKey();
  const salt = generateSalt(16);
  const masterKey = deriveMasterKey(PASSWORD, salt, profile);
  const master = wrapVaultKey({
    vaultKey,
    wrappingKey: masterKey,
    vaultId,
    type: "master",
    vaultKeyVersion: 1,
    kdf: kdfParamsFrom(profile, salt),
  });
  const target = wrapVaultKey({
    vaultKey,
    wrappingKey: generateVaultKey(),
    vaultId,
    type: "device",
    vaultKeyVersion: 1,
    deviceId: TARGET,
    deviceKeyVersion: 1,
  });
  return {
    vaultId,
    revision: 1,
    vaultKeyVersion: 1,
    vaultKey,
    envelopes: [master, target],
    entries: [
      {
        id: "entry_demo",
        kind: "web",
        title: "Demo",
        provider: "",
        account: "",
        username: "u",
        password: "secret",
        url: "",
        host: "",
        port: "",
        protocol: "",
        capabilities: "",
        notes: "",
        updatedAt: new Date().toISOString(),
      },
    ],
    unlockedWith: "master_password",
  };
}

test("revokeDevice omits the envelope, commits, then DELETE", async () => {
  const vault = buildUnlocked();
  const { calls, committedPayload } = mockApis();

  const updated = await revokeDevice(vault, TARGET);

  assert.deepEqual(calls, ["commit", "delete"]);
  assert.ok(committedPayload.current);
  assert.equal(committedPayload.current.vaultKeyVersion, 1);
  assert.equal(committedPayload.current.revision, 2);
  const deviceIds = committedPayload.current.envelopes
    .filter((env) => env.type === "device")
    .map((env) => env.deviceId);
  assert.ok(!deviceIds.includes(TARGET));
  assert.equal(updated.revision, 2);
  assert.equal(updated.vaultKeyVersion, 1);
  assert.ok(!updated.envelopes.some((env) => env.type === "device" && env.deviceId === TARGET));
});

test("revokeDevice does not DELETE when CAS returns 409", async () => {
  const vault = buildUnlocked();
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
    () => revokeDevice(vault, TARGET),
    (error: unknown) => error instanceof CommitConflict,
  );
  assert.deepEqual(calls, ["commit"]);
});
