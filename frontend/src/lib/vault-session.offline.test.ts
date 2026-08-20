/**
 * Offline unlock: last verified wire snapshot, pin still applies.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  RollbackError,
  buildManifest,
  deriveMasterKey,
  encodeVaultSnapshot,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  sealManifest,
  wrapVaultKey,
} from "@4allpass/crypto";

import { api } from "./api.ts";
import { savePin } from "./revision-pin.ts";
import { memorySnapshotCache, setSnapshotCacheForTests } from "./snapshot-cache.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { unlockWithMasterPassword } from "./vault-session.ts";

const PASSWORD = "offline-master-password";
const profile = ARGON2ID_PROFILES.mobile_safe;
const originalGet = api.getSnapshot.bind(api);

afterEach(() => {
  clearTestStorage();
  setSnapshotCacheForTests(null);
  api.getSnapshot = originalGet;
});

function sealedSnapshot(vaultId: string, revision: number) {
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
  const sealedManifest = sealManifest({
    vaultKey,
    manifest: buildManifest({
      vaultId,
      revision,
      vaultKeyVersion: 1,
      envelopes: [master],
      entries: [],
    }),
  });
  return encodeVaultSnapshot({
    vaultId,
    revision,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1,
    envelopes: [master],
    entries: [],
    sealedManifest,
  });
}

test("unlocks from the cached snapshot when the network is down", async () => {
  const vaultId = "vault-offline-ok";
  const wire = sealedSnapshot(vaultId, 1);
  const cache = memorySnapshotCache();
  await cache.save(vaultId, wire);
  setSnapshotCacheForTests(cache);
  api.getSnapshot = async () => {
    throw new TypeError("Failed to fetch");
  };
  const vault = await unlockWithMasterPassword(vaultId, PASSWORD);
  assert.equal(vault.vaultId, vaultId);
  assert.equal(vault.revision, 1);
});

test("refuses a cached snapshot older than the pin", async () => {
  const vaultId = "vault-offline-stale";
  const wire = sealedSnapshot(vaultId, 1);
  const cache = memorySnapshotCache();
  await cache.save(vaultId, wire);
  setSnapshotCacheForTests(cache);
  savePin({
    vaultId,
    revision: 4,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1,
  });
  api.getSnapshot = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(() => unlockWithMasterPassword(vaultId, PASSWORD), RollbackError);
});

test("HTTP errors do not fall back to cache", async () => {
  const vaultId = "vault-offline-http";
  const wire = sealedSnapshot(vaultId, 1);
  const cache = memorySnapshotCache();
  await cache.save(vaultId, wire);
  setSnapshotCacheForTests(cache);
  api.getSnapshot = async () => {
    throw new Error("500 from server");
  };
  await assert.rejects(() => unlockWithMasterPassword(vaultId, PASSWORD), /500 from server/);
});
