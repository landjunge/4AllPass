/**
 * E03/P02: a commit is only "saved" when the 200 carries the written revision.
 *
 * Before, a server (or anything in between) answering the POST with the old,
 * still-authentic head made `commitEntries` resolve: the pin check saw "same",
 * the old head opened, and the new entry vanished behind a success message.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  IntegrityError,
  buildManifest,
  deriveRecoveryWrappingKey,
  encodeVaultSnapshot,
  generateRecoveryKey,
  generateVaultKey,
  sealManifest,
  wrapVaultKey,
  zeroize,
} from "@4allpass/crypto";

import { api } from "./api.ts";
import { emptyDraft } from "./entries.ts";
import { loadPin } from "./revision-pin.ts";
import { setSnapshotCacheForTests } from "./snapshot-cache.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { commitEntries, type UnlockedVault } from "./vault-session.ts";

const originalCommit = api.commitSnapshot.bind(api);
afterEach(() => {
  clearTestStorage();
  setSnapshotCacheForTests(null);
  api.commitSnapshot = originalCommit;
});

function fixture() {
  const vaultId = "vault-commit-echo";
  const vaultKey = generateVaultKey();
  const recoveryKey = generateRecoveryKey();
  const wrappingKey = deriveRecoveryWrappingKey({ recoveryKey, vaultId });
  const recovery = wrapVaultKey({
    vaultKey, wrappingKey, vaultId, type: "recovery", vaultKeyVersion: 1,
  });
  const head = encodeVaultSnapshot({
    vaultId, revision: 1, vaultKeyVersion: 1, cryptoProtocolVersion: 1,
    envelopes: [recovery], entries: [],
    sealedManifest: sealManifest({
      vaultKey,
      manifest: buildManifest({ vaultId, revision: 1, vaultKeyVersion: 1, envelopes: [recovery], entries: [] }),
    }),
  });
  const vault: UnlockedVault = {
    vaultId, revision: 1, vaultKeyVersion: 1, vaultKey: vaultKey.slice(),
    envelopes: [recovery], entries: [], unlockedWith: "recovery_key",
  };
  return { head, vault, dispose: () => zeroize(vaultKey, recoveryKey, wrappingKey, vault.vaultKey) };
}

const entry = { ...emptyDraft(), id: "entry-new", title: "New entry", updatedAt: "2026-11-10T00:00:00Z" };

test("a 200 that returns the old head is an integrity failure, not a save", async () => {
  const f = fixture();
  try {
    api.commitSnapshot = async () => f.head;
    await assert.rejects(() => commitEntries(f.vault, [entry]), IntegrityError);
    assert.equal(loadPin(f.vault.vaultId), null, "nothing may be pinned from the stale answer");
  } finally {
    f.dispose();
  }
});

test("a 200 that echoes the written snapshot still saves", async () => {
  const f = fixture();
  try {
    api.commitSnapshot = async (id, payload) => ({
      vaultId: id,
      revision: payload.revision,
      vaultKeyVersion: payload.vaultKeyVersion,
      cryptoProtocolVersion: 1,
      envelopes: payload.envelopes,
      entries: payload.entries,
      sealedManifest: payload.sealedManifest,
    });
    const saved = await commitEntries(f.vault, [entry]);
    assert.equal(saved.revision, 2);
    assert.deepEqual(saved.entries.map((e) => e.id), ["entry-new"]);
    zeroize(saved.vaultKey);
  } finally {
    f.dispose();
  }
});
