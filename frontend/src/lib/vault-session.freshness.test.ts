/**
 * After a digest pin, a higher-revision GET without sealedManifest is refused
 * and the pin is not rewritten. Revert of F-1 must turn this red.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  IntegrityError,
  buildManifest,
  deriveMasterKey,
  encodeVaultSnapshot,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  sealManifest,
  sealedManifestDigest,
  wrapVaultKey,
} from "@4allpass/crypto";

import { api } from "./api.ts";
import { loadPin, savePin } from "./revision-pin.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { unlockWithMasterPassword } from "./vault-session.ts";

const PASSWORD = "freshness-master-password";
const profile = ARGON2ID_PROFILES.mobile_safe;
const originalGet = api.getSnapshot.bind(api);

afterEach(() => {
  clearTestStorage();
  api.getSnapshot = originalGet;
});

function snapshotWithoutManifest(vaultId: string, revision: number) {
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
  return encodeVaultSnapshot({
    vaultId,
    revision,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1,
    envelopes: [master],
    entries: [],
  });
}

test("unlockWithMasterPassword refuses a higher-revision snapshot that omits sealedManifest after a digest pin", async () => {
  const vaultId = "vault-freshness-no-manifest";
  const vaultKey = generateVaultKey();
  const sealed = sealManifest({
    vaultKey,
    manifest: buildManifest({
      vaultId,
      revision: 2,
      vaultKeyVersion: 1,
      envelopes: [],
      entries: [],
    }),
  });
  const digest = sealedManifestDigest(sealed);
  savePin({
    vaultId,
    revision: 2,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1,
    manifestDigest: digest,
  });
  api.getSnapshot = async () => snapshotWithoutManifest(vaultId, 3);
  await assert.rejects(() => unlockWithMasterPassword(vaultId, PASSWORD), IntegrityError);
  const pin = loadPin(vaultId);
  assert.equal(pin?.revision, 2);
  assert.deepEqual(pin?.manifestDigest, digest);
});
