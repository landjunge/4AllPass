/**
 * E03/P01, F-25 evidence: how fast the Vault Key spends its random-nonce budget.
 *
 * There is no persistent seal counter (crypto-protocol.md §3.3). This test pins
 * the rate the bound in docs/evidence/e03-p00-p01-20261110 is computed from:
 * every commit attempt, including one the server refuses, seals all N entries
 * plus one manifest under the Vault Key with fresh nonces; envelopes are carried
 * over byte-identical and spend nothing under the Vault Key.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  base64ToBytes,
  bytesToHex,
  deriveRecoveryWrappingKey,
  generateRecoveryKey,
  generateVaultKey,
  wrapVaultKey,
  zeroize,
} from "@4allpass/crypto";

import { api, ApiError } from "./api.ts";
import { emptyDraft, type VaultEntry } from "./entries.ts";
import { setSnapshotCacheForTests } from "./snapshot-cache.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { CommitConflict, commitEntries, type UnlockedVault } from "./vault-session.ts";

const originalCommit = api.commitSnapshot.bind(api);
afterEach(() => {
  clearTestStorage();
  setSnapshotCacheForTests(null);
  api.commitSnapshot = originalCommit;
});

const N = 7;

test("every commit attempt seals N entries + 1 manifest under VK with fresh nonces", async () => {
  const vaultId = "vault-nonce-budget";
  const vaultKey = generateVaultKey();
  const recoveryKey = generateRecoveryKey();
  const wrappingKey = deriveRecoveryWrappingKey({ recoveryKey, vaultId });
  const recovery = wrapVaultKey({
    vaultKey, wrappingKey, vaultId, type: "recovery", vaultKeyVersion: 1,
  });
  const entries: VaultEntry[] = Array.from({ length: N }, (_, i) => ({
    ...emptyDraft(),
    id: `entry-${i}`,
    title: `Synthetic ${i}`,
    username: "synthetic",
    password: "dummy-only",
    updatedAt: "2026-11-10T00:00:00Z",
  }));
  let vault: UnlockedVault = {
    vaultId, revision: 1, vaultKeyVersion: 1, vaultKey: vaultKey.slice(),
    envelopes: [recovery], entries, unlockedWith: "recovery_key",
  };

  const attempts: { nonces: string[]; envelopeNonces: string[] }[] = [];
  let refuseNext = false;
  api.commitSnapshot = async (id, payload) => {
    attempts.push({
      nonces: [
        ...payload.entries.map((entry) => entry.nonce),
        payload.sealedManifest.nonce,
      ],
      envelopeNonces: payload.envelopes.map((envelope) => envelope.nonce),
    });
    if (refuseNext) {
      refuseNext = false;
      throw new ApiError(409, { currentRevision: payload.expectedRevision + 1 });
    }
    return {
      vaultId: id,
      revision: payload.revision,
      vaultKeyVersion: payload.vaultKeyVersion,
      cryptoProtocolVersion: 1,
      envelopes: payload.envelopes,
      entries: payload.entries,
      sealedManifest: payload.sealedManifest,
    };
  };

  try {
    vault = await commitEntries(vault, vault.entries);
    refuseNext = true;
    await assert.rejects(() => commitEntries(vault, vault.entries), CommitConflict);
    vault = await commitEntries(vault, vault.entries);
    assert.equal(vault.revision, 3, "the refused attempt does not advance the revision");

    assert.equal(attempts.length, 3);
    const all = new Set<string>();
    for (const attempt of attempts) {
      assert.equal(attempt.nonces.length, N + 1, "seals under VK per attempt");
      for (const nonce of attempt.nonces) {
        assert.equal(base64ToBytes(nonce).length, 12);
        all.add(nonce);
      }
      assert.deepEqual(
        attempt.envelopeNonces.map((nonce) => bytesToHex(base64ToBytes(nonce))),
        [bytesToHex(recovery.nonce)],
        "envelopes are carried over, not re-sealed",
      );
    }
    // 3 attempts, 2 accepted revisions: the budget is spent per attempt.
    assert.equal(all.size, 3 * (N + 1), "no nonce repeats across attempts");
  } finally {
    zeroize(vaultKey, recoveryKey, wrappingKey, vault.vaultKey);
  }
});
