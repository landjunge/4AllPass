/**
 * Offline unlock: last verified wire snapshot, pin still applies.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  AuthFailureError,
  RollbackError,
  bytesToBase64,
  bytesToHex,
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
import { emptyDraft, type VaultEntry } from "./entries.ts";
import { savePin } from "./revision-pin.ts";
import { memorySnapshotCache, setSnapshotCacheForTests } from "./snapshot-cache.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { commitEntries, unlockWithMasterPassword } from "./vault-session.ts";

const PASSWORD = "offline-master-password";
const profile = ARGON2ID_PROFILES.mobile_safe;
const originalGet = api.getSnapshot.bind(api);
const originalCommit = api.commitSnapshot.bind(api);

afterEach(() => {
  clearTestStorage();
  setSnapshotCacheForTests(null);
  api.getSnapshot = originalGet;
  api.commitSnapshot = originalCommit;
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

test("the cache holds ciphertext only and is not replaced by a failed open", async () => {
  // E03/P02: neither plaintext nor key material may reach the offline cache, and
  // a tampered higher head must leave the last verified snapshot in place.
  const vaultId = "vault-offline-ciphertext-only";
  const cache = memorySnapshotCache();
  setSnapshotCacheForTests(cache);
  api.getSnapshot = async () => sealedSnapshot(vaultId, 1);
  const opened = await unlockWithMasterPassword(vaultId, PASSWORD);
  api.commitSnapshot = async (id, payload) => ({
    vaultId: id,
    revision: payload.revision,
    vaultKeyVersion: payload.vaultKeyVersion,
    cryptoProtocolVersion: 1,
    envelopes: payload.envelopes,
    entries: payload.entries,
    sealedManifest: payload.sealedManifest,
  });
  const canary: VaultEntry = {
    ...emptyDraft(),
    id: "entry-canary",
    title: "Offline canary title",
    username: "canary-user",
    password: "canary-secret-value",
    updatedAt: "2026-11-10T00:00:00Z",
  };
  const committed = await commitEntries(opened, [canary]);
  const cached = await cache.load(vaultId);
  assert.ok(cached);
  assert.equal(cached.revision, 2);
  const text = JSON.stringify(cached);
  for (const needle of [
    canary.title,
    canary.username,
    canary.password,
    PASSWORD,
    bytesToBase64(committed.vaultKey),
    bytesToHex(committed.vaultKey),
  ]) {
    assert.equal(text.includes(needle), false, `cache leaks ${needle.slice(0, 8)}…`);
  }

  const tampered = structuredClone(cached);
  tampered.revision = 3;
  api.getSnapshot = async () => tampered;
  // The revision is in the manifest AAD, so the lie fails the GCM tag.
  await assert.rejects(() => unlockWithMasterPassword(vaultId, PASSWORD), AuthFailureError);
  assert.equal((await cache.load(vaultId))?.revision, 2, "failed open must not replace the cache");
});
