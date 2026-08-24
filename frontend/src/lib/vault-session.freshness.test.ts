/**
 * Freshness regressions, from the stance of a malicious server.
 *
 * Every test here was first a working attack against `vault-session.ts`. They
 * cover the two ways the client used to hand freshness back to the server:
 *
 * 1. `openSnapshot` treated a missing `sealedManifest` as "legacy, pin the
 *    numbers the server sent". Stripping the manifest therefore rolled entries
 *    back, re-attached revoked device envelopes, and poisoned the pin.
 * 2. `acceptSnapshot` ran no freshness check on a *commit response*, so a write
 *    could be answered with an older authentic snapshot.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  buildManifest,
  deriveMasterKey,
  deriveRecoveryWrappingKey,
  encodeVaultSnapshot,
  encryptEntry,
  formatRecoveryKey,
  generateDeviceKey,
  generateRecoveryKey,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  sealManifest,
  wrapVaultKey,
  type EncryptedEntry,
  type KeyEnvelope,
  type WireVaultSnapshot,
} from "@4allpass/crypto";

import { api } from "./api.ts";
import { encodeEntryPlaintext, type VaultEntry } from "./entries.ts";
import { loadPin } from "./revision-pin.ts";
import { setSnapshotCacheForTests } from "./snapshot-cache.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { commitEntries, unlockWithRecoveryKey } from "./vault-session.ts";

const VKV = 1;
const profile = ARGON2ID_PROFILES.mobile_safe;

const originalGet = api.getSnapshot.bind(api);
const originalCommit = api.commitSnapshot.bind(api);

afterEach(() => {
  clearTestStorage();
  setSnapshotCacheForTests(null);
  api.getSnapshot = originalGet;
  api.commitSnapshot = originalCommit;
});

function entry(id: string, password: string): VaultEntry {
  return {
    id,
    kind: "web",
    title: "GitHub",
    provider: "GitHub",
    account: "",
    username: "alice",
    password,
    url: "https://github.com",
    host: "",
    port: "",
    protocol: "",
    capabilities: "",
    credentialType: "password",
    notes: "",
    totpSecret: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    domain: "github.com",
    providerId: "github",
    providerConfidence: 1,
    providerMatchType: "host",
  };
}

/**
 * One vault, one Vault Key, so records minted for different revisions all still
 * decrypt — exactly the material a server that kept old snapshots would hold.
 */
function makeVault(vaultId: string) {
  const vaultKey = generateVaultKey();
  const recoveryKey = generateRecoveryKey();
  const recoveryWrappingKey = deriveRecoveryWrappingKey({ recoveryKey, vaultId });
  const recovery = wrapVaultKey({
    vaultKey,
    wrappingKey: recoveryWrappingKey,
    vaultId,
    type: "recovery",
    vaultKeyVersion: VKV,
  });
  const salt = generateSalt(16);
  const master = wrapVaultKey({
    vaultKey,
    wrappingKey: deriveMasterKey("freshness-master-password", salt, profile),
    vaultId,
    type: "master",
    vaultKeyVersion: VKV,
    kdf: kdfParamsFrom(profile, salt),
  });

  return {
    recoveryKeyText: formatRecoveryKey(recoveryKey),
    envelopes: [master, recovery] as KeyEnvelope[],
    deviceEnvelope(deviceId: string): KeyEnvelope {
      return wrapVaultKey({
        vaultKey,
        wrappingKey: generateDeviceKey(),
        vaultId,
        type: "device",
        vaultKeyVersion: VKV,
        deviceId,
        deviceKeyVersion: 1,
      });
    },
    seal(id: string, password: string): EncryptedEntry {
      return encryptEntry({
        vaultKey,
        vaultId,
        entryId: id,
        plaintext: encodeEntryPlaintext(entry(id, password)),
        vaultKeyVersion: VKV,
        schemaVersion: 1,
      });
    },
    wire(options: {
      revision: number;
      envelopes: KeyEnvelope[];
      entries: EncryptedEntry[];
      /** A malicious server strips it; an honest one always sends it. */
      sealed: boolean;
    }): WireVaultSnapshot {
      const { revision, envelopes, entries } = options;
      return encodeVaultSnapshot({
        vaultId,
        revision,
        vaultKeyVersion: VKV,
        cryptoProtocolVersion: 1,
        envelopes,
        entries,
        ...(options.sealed
          ? {
              sealedManifest: sealManifest({
                vaultKey,
                manifest: buildManifest({
                  vaultId,
                  revision,
                  vaultKeyVersion: VKV,
                  envelopes,
                  entries,
                }),
              }),
            }
          : {}),
      });
    },
  };
}

test("refuses a manifest-free snapshot that rolls an entry back to a stale password", async () => {
  const vaultId = "vault-strip-entry-rollback";
  const v = makeVault(vaultId);
  const id = "entry_0001";

  api.getSnapshot = async () =>
    v.wire({ revision: 5, envelopes: v.envelopes, entries: [v.seal(id, "ROTATED")], sealed: true });
  const first = await unlockWithRecoveryKey(vaultId, v.recoveryKeyText);
  assert.equal(first.entries[0]?.password, "ROTATED");
  assert.ok(loadPin(vaultId)?.manifestDigest, "pin carries a verified manifest digest");

  // Revision 6, the pre-rotation entry record, no manifest to prove the set.
  api.getSnapshot = async () =>
    v.wire({ revision: 6, envelopes: v.envelopes, entries: [v.seal(id, "LEAKED")], sealed: false });
  await assert.rejects(
    () => unlockWithRecoveryKey(vaultId, v.recoveryKeyText),
    /pinned with a verified manifest/,
  );
  assert.ok(loadPin(vaultId)?.manifestDigest, "the pin still holds its digest");
  assert.equal(loadPin(vaultId)?.revision, 5, "the pin did not move");
});

test("refuses a manifest-free snapshot that re-attaches a revoked device envelope", async () => {
  const vaultId = "vault-strip-revoked-device";
  const v = makeVault(vaultId);
  const revoked = v.deviceEnvelope("dev_stolen_laptop_aaaa");

  api.getSnapshot = async () =>
    v.wire({ revision: 9, envelopes: v.envelopes, entries: [], sealed: true });
  await unlockWithRecoveryKey(vaultId, v.recoveryKeyText);

  api.getSnapshot = async () =>
    v.wire({ revision: 10, envelopes: [...v.envelopes, revoked], entries: [], sealed: false });
  await assert.rejects(
    () => unlockWithRecoveryKey(vaultId, v.recoveryKeyText),
    /pinned with a verified manifest/,
  );
});

test("refuses a manifest-free snapshot claiming an absurd revision, so the pin cannot be poisoned", async () => {
  const vaultId = "vault-strip-pin-poison";
  const v = makeVault(vaultId);

  api.getSnapshot = async () =>
    v.wire({ revision: 2, envelopes: v.envelopes, entries: [], sealed: true });
  await unlockWithRecoveryKey(vaultId, v.recoveryKeyText);

  api.getSnapshot = async () =>
    v.wire({ revision: 0xffffffff, envelopes: v.envelopes, entries: [], sealed: false });
  await assert.rejects(
    () => unlockWithRecoveryKey(vaultId, v.recoveryKeyText),
    /pinned with a verified manifest/,
  );
  assert.equal(loadPin(vaultId)?.revision, 2, "pin was not poisoned from unverified metadata");

  // The honest head still unlocks: the refusal above is not a self-inflicted DoS.
  api.getSnapshot = async () =>
    v.wire({ revision: 3, envelopes: v.envelopes, entries: [], sealed: true });
  const vault = await unlockWithRecoveryKey(vaultId, v.recoveryKeyText);
  assert.equal(vault.revision, 3);
});

test("never writes a pin from a manifest-free snapshot", async () => {
  const vaultId = "vault-legacy-no-manifest";
  const v = makeVault(vaultId);

  // A vault that has never published a manifest still opens (vault-revision.md
  // §6: the content pass alone works for pre-manifest snapshots) but its
  // server-asserted revision is not a cryptographic statement, so it is not
  // pinned.
  api.getSnapshot = async () =>
    v.wire({ revision: 7, envelopes: v.envelopes, entries: [], sealed: false });
  const vault = await unlockWithRecoveryKey(vaultId, v.recoveryKeyText);
  assert.equal(vault.revision, 7);
  assert.equal(loadPin(vaultId), null, "no pin was written from unverified metadata");
});

test("refuses a commit answered with an older authentic snapshot", async () => {
  const vaultId = "vault-commit-rollback";
  const v = makeVault(vaultId);
  const id = "entry_0001";

  api.getSnapshot = async () =>
    v.wire({ revision: 12, envelopes: v.envelopes, entries: [v.seal(id, "CURRENT")], sealed: true });
  const vault = await unlockWithRecoveryKey(vaultId, v.recoveryKeyText);
  assert.equal(loadPin(vaultId)?.revision, 12);

  // The user saves an edit; the server answers with revision 3, which is old but
  // perfectly authentic and opens under the same VK.
  api.commitSnapshot = async () =>
    v.wire({
      revision: 3,
      envelopes: v.envelopes,
      entries: [v.seal(id, "PRE-BREACH")],
      sealed: true,
    });
  await assert.rejects(
    () => commitEntries(vault, [entry(id, "BRAND-NEW")]),
    /commit response is revision 3, we published 13/,
  );
  assert.equal(loadPin(vaultId)?.revision, 12, "pin did not move backwards");
});

test("refuses a commit answered with a manifest we did not publish", async () => {
  const vaultId = "vault-commit-substituted-manifest";
  const v = makeVault(vaultId);
  const id = "entry_0001";

  api.getSnapshot = async () =>
    v.wire({ revision: 4, envelopes: v.envelopes, entries: [v.seal(id, "CURRENT")], sealed: true });
  const vault = await unlockWithRecoveryKey(vaultId, v.recoveryKeyText);

  // Right revision, wrong contents: the server drops the edit and re-seals the
  // previous entry set under revision 5.
  api.commitSnapshot = async () =>
    v.wire({
      revision: 5,
      envelopes: v.envelopes,
      entries: [v.seal(id, "CURRENT")],
      sealed: true,
    });
  await assert.rejects(
    () => commitEntries(vault, [entry(id, "BRAND-NEW")]),
    /manifest we did not publish/,
  );
});

test("refuses a commit whose response has no sealed manifest", async () => {
  const vaultId = "vault-commit-stripped-manifest";
  const v = makeVault(vaultId);

  api.getSnapshot = async () =>
    v.wire({ revision: 4, envelopes: v.envelopes, entries: [], sealed: true });
  const vault = await unlockWithRecoveryKey(vaultId, v.recoveryKeyText);

  api.commitSnapshot = async () =>
    v.wire({ revision: 5, envelopes: v.envelopes, entries: [], sealed: false });
  await assert.rejects(() => commitEntries(vault, []), /dropped the sealed manifest/);
});
