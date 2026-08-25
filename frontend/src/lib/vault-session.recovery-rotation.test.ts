/**
 * Recovery kit: trusted replacement keeps VK; compromised kit must VK++.
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

import { api } from "./api.ts";
import { setSnapshotCacheForTests } from "./snapshot-cache.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import {
  replaceTrustedRecoveryKey,
  rotateCompromisedRecovery,
  type UnlockedVault,
} from "./vault-session.ts";

const PASSWORD = "recovery-rotation-master-password";
const SELF = "dev_self_recovery_rotation01";
const profile = ARGON2ID_PROFILES.mobile_safe;

const originalCommit = api.commitSnapshot.bind(api);

afterEach(() => {
  clearTestStorage();
  setSnapshotCacheForTests(null);
  api.commitSnapshot = originalCommit;
});

function mockCommit(): void {
  api.commitSnapshot = async (vaultId, payload) => ({
    vaultId,
    revision: payload.revision,
    vaultKeyVersion: payload.vaultKeyVersion,
    cryptoProtocolVersion: 1,
    envelopes: payload.envelopes,
    entries: payload.entries,
    sealedManifest: payload.sealedManifest,
  });
}

function buildUnlocked(): { vault: UnlockedVault; recoveryKeyText: string } {
  localStorage.setItem("4allpass.deviceId", SELF);
  const vaultId = "vault-recovery-rotation-test-1";
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
  const vault: UnlockedVault = {
    vaultId,
    revision: 1,
    vaultKeyVersion: 1,
    vaultKey,
    envelopes: [master, recovery],
    entries: [],
    unlockedWith: "master_password",
  };
  return { vault, recoveryKeyText: formatRecoveryKey(recoveryKey) };
}

test("replaceTrustedRecoveryKey keeps VK and retires the old print", async () => {
  const { vault, recoveryKeyText } = buildUnlocked();
  mockCommit();
  const replaced = await replaceTrustedRecoveryKey(vault, recoveryKeyText);
  assert.equal(replaced.vault.vaultKeyVersion, 1);
  assert.equal(replaced.vault.revision, 2);
  assert.notEqual(replaced.recoveryKey, recoveryKeyText);

  const oldRwk = deriveRecoveryWrappingKey({
    recoveryKey: parseRecoveryKey(recoveryKeyText),
    vaultId: vault.vaultId,
  });
  const next = replaced.vault.envelopes.find((envelope) => envelope.type === "recovery");
  assert.ok(next);
  assert.throws(
    () =>
      unwrapVaultKey(next, {
        wrappingKey: oldRwk,
        vaultId: vault.vaultId,
        expectType: "recovery",
        expectVaultKeyVersion: 1,
      }),
    AuthFailureError,
  );
});

test("rotateCompromisedRecovery increments VK and the stolen print cannot wrap VK2", async () => {
  const { vault, recoveryKeyText } = buildUnlocked();
  mockCommit();
  const rotated = await rotateCompromisedRecovery(vault, {
    masterPassword: PASSWORD,
    previousRecoveryKeyText: recoveryKeyText,
  });
  assert.equal(rotated.vault.vaultKeyVersion, 2);
  assert.equal(rotated.vault.revision, 2);
  assert.notEqual(rotated.recoveryKey, recoveryKeyText);

  const stolenRwk = deriveRecoveryWrappingKey({
    recoveryKey: parseRecoveryKey(recoveryKeyText),
    vaultId: vault.vaultId,
  });
  const next = rotated.vault.envelopes.find((envelope) => envelope.type === "recovery");
  assert.ok(next);
  assert.equal(next.vaultKeyVersion, 2);
  assert.throws(
    () =>
      unwrapVaultKey(next, {
        wrappingKey: stolenRwk,
        vaultId: vault.vaultId,
        expectType: "recovery",
        expectVaultKeyVersion: 2,
      }),
    AuthFailureError,
  );
});
