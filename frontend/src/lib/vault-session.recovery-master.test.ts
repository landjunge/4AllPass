/**
 * Recovery unlock → deliberate new master password, plus kit continuity across
 * hard revoke and kit retirement on compromised rotation.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  AuthFailureError,
  deriveMasterKey,
  deriveRecoveryWrappingKey,
  formatRecoveryKey,
  generateRecoveryKey,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  parseRecoveryKey,
  unwrapVaultKey,
  wrapVaultKey,
} from "@4allpass/crypto";

import { api, ApiError } from "./api.ts";
import { describeError } from "../modules/feedback/errors/describe-error.ts";
import { setSnapshotCacheForTests } from "./snapshot-cache.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { loadPin } from "./revision-pin.ts";
import {
  CommitConflict,
  establishMasterAfterRecovery,
  hardRevokeDevice,
  rotateCompromisedRecovery,
  type UnlockedVault,
} from "./vault-session.ts";

const PASSWORD = "recovery-master-old-password";
const NEW_PASSWORD = "recovery-master-new-password";
const SELF = "dev_self_recovery_master01";
const profile = ARGON2ID_PROFILES.mobile_safe;

const originalCommit = api.commitSnapshot.bind(api);

afterEach(() => {
  clearTestStorage();
  setSnapshotCacheForTests(null);
  api.commitSnapshot = originalCommit;
});

function buildVault(unlockedWith: UnlockedVault["unlockedWith"] = "recovery_key"): {
  vault: UnlockedVault;
  recoveryKeyText: string;
  recoveryKey: Uint8Array;
} {
  localStorage.setItem("4allpass.deviceId", SELF);
  const vaultId = "vault-recovery-master-test-1";
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
  return {
    vault: {
      vaultId,
      revision: 1,
      vaultKeyVersion: 1,
      vaultKey,
      envelopes: [master, recovery],
      entries: [],
      unlockedWith,
    },
    recoveryKeyText: formatRecoveryKey(recoveryKey),
    recoveryKey,
  };
}

function mockCommit(): { calls: number } {
  const state = { calls: 0 };
  api.commitSnapshot = async (vaultId, payload) => {
    state.calls += 1;
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
  return state;
}

function envelopeOf(vault: UnlockedVault, type: "master" | "recovery") {
  const envelope = vault.envelopes.find((candidate) => candidate.type === type);
  assert.ok(envelope, `${type} envelope`);
  return envelope;
}

test("a new master password is only offered after a recovery unlock", async () => {
  const { vault } = buildVault("master_password");
  mockCommit();
  await assert.rejects(() => establishMasterAfterRecovery(vault, NEW_PASSWORD), /recovery unlock/);
});

test("a lock during the flow aborts before any commit", async () => {
  const { vault } = buildVault();
  const state = mockCommit();
  await assert.rejects(
    () =>
      establishMasterAfterRecovery(vault, NEW_PASSWORD, {
        epoch: 1,
        isLive: () => false,
        assertLive: () => {
          throw new Error("locked");
        },
      }),
    /locked/,
  );
  assert.equal(state.calls, 0);
});

test("the new master opens the same vault key and the old password no longer does", async () => {
  const { vault } = buildVault();
  const state = mockCommit();
  const updated = await establishMasterAfterRecovery(vault, NEW_PASSWORD);
  assert.equal(state.calls, 1);
  assert.equal(updated.revision, 2);
  assert.equal(updated.vaultKeyVersion, 1);
  assert.deepEqual(updated.vaultKey, vault.vaultKey);

  const master = envelopeOf(updated, "master");
  assert.ok(master.kdf);
  const newKey = deriveMasterKey(NEW_PASSWORD, master.kdf.salt, master.kdf);
  const opened = unwrapVaultKey(master, {
    wrappingKey: newKey,
    vaultId: updated.vaultId,
    expectType: "master",
    expectVaultKeyVersion: 1,
  });
  assert.deepEqual(opened, updated.vaultKey);

  const oldKey = deriveMasterKey(PASSWORD, master.kdf.salt, master.kdf);
  await assert.rejects(async () =>
    unwrapVaultKey(master, {
      wrappingKey: oldKey,
      vaultId: updated.vaultId,
      expectType: "master",
      expectVaultKeyVersion: 1,
    }),
  );
  assert.ok(loadPin(updated.vaultId), "accepted snapshot is pinned");
});

test("a 409 leaves the pin untouched and does not retry", async () => {
  const { vault } = buildVault();
  let calls = 0;
  api.commitSnapshot = async () => {
    calls += 1;
    throw new ApiError(409, { detail: "revision conflict", currentRevision: 1 });
  };
  await assert.rejects(() => establishMasterAfterRecovery(vault, NEW_PASSWORD), CommitConflict);
  assert.equal(calls, 1);
  assert.equal(loadPin(vault.vaultId), null);
});

test("an unknown/lost response is not retried and does not move the pin", async () => {
  const { vault } = buildVault();
  let calls = 0;
  api.commitSnapshot = async () => {
    calls += 1;
    throw new TypeError("fetch failed");
  };
  await assert.rejects(() => establishMasterAfterRecovery(vault, NEW_PASSWORD), TypeError);
  assert.equal(calls, 1);
  assert.equal(loadPin(vault.vaultId), null);
});

test("a revoked device write is mapped to a clear read-only message", () => {
  const feedback = describeError(new ApiError(403, { detail: "device is revoked for this vault" }));
  assert.equal(feedback.code, "device_write_locked");
  assert.match(feedback.userText.de, /widerrufen/i);
});

test("hard revoke keeps the trusted kit working against the new VK", async () => {
  const { vault, recoveryKeyText, recoveryKey } = buildVault("master_password");
  const oldVaultKey = vault.vaultKey.slice();
  mockCommit();
  const committed = await hardRevokeDevice(vault, {
    targetDeviceId: "dev_other_hard_revoke01",
    masterPassword: PASSWORD,
    recoveryKeyText,
  });
  assert.equal(committed.vault.vaultKeyVersion, 2);
  assert.notDeepEqual(committed.vault.vaultKey, oldVaultKey);

  const recovery = envelopeOf(committed.vault, "recovery");
  const rwk = deriveRecoveryWrappingKey({ recoveryKey, vaultId: vault.vaultId });
  const opened = unwrapVaultKey(recovery, {
    wrappingKey: rwk,
    vaultId: vault.vaultId,
    expectType: "recovery",
    expectVaultKeyVersion: 2,
  });
  assert.deepEqual(opened, committed.vault.vaultKey);
});

test("compromised rotation retires the old print for the new head only", async () => {
  const { vault, recoveryKeyText, recoveryKey } = buildVault("master_password");
  const oldVaultKey = vault.vaultKey.slice();
  mockCommit();
  const oldRecoveryEnvelope = envelopeOf(vault, "recovery");
  const rotated = await rotateCompromisedRecovery(vault, {
    masterPassword: PASSWORD,
    previousRecoveryKeyText: recoveryKeyText,
  });
  assert.equal(rotated.vault.vaultKeyVersion, 2);
  assert.notEqual(rotated.recoveryKey, recoveryKeyText);

  const newRecovery = envelopeOf(rotated.vault, "recovery");
  const oldRwk = deriveRecoveryWrappingKey({ recoveryKey, vaultId: vault.vaultId });
  await assert.rejects(async () =>
    unwrapVaultKey(newRecovery, {
      wrappingKey: oldRwk,
      vaultId: vault.vaultId,
      expectType: "recovery",
      expectVaultKeyVersion: 2,
    }),
    AuthFailureError,
  );

  const nextKey = parseRecoveryKey(rotated.recoveryKey);
  const nextRwk = deriveRecoveryWrappingKey({ recoveryKey: nextKey, vaultId: vault.vaultId });
  const opened = unwrapVaultKey(newRecovery, {
    wrappingKey: nextRwk,
    vaultId: vault.vaultId,
    expectType: "recovery",
    expectVaultKeyVersion: 2,
  });
  assert.deepEqual(opened, rotated.vault.vaultKey);

  // The old print still opens the old (historic) envelope for the old VK.
  const historic = unwrapVaultKey(oldRecoveryEnvelope, {
    wrappingKey: oldRwk,
    vaultId: vault.vaultId,
    expectType: "recovery",
    expectVaultKeyVersion: 1,
  });
  assert.deepEqual(historic, oldVaultKey);
});
