import assert from "node:assert/strict";
import {
  ARGON2ID_PROFILES,
  buildManifest,
  hexToBytes,
  kdfParamsFrom,
  type EncryptedEntry,
  type KeyEnvelope,
  type SnapshotManifest,
} from "../src/index.ts";
import {
  encryptEntryWithNonce,
  sealManifestWithNonce,
  wrapVaultKeyWithNonce,
} from "../src/test-only.ts";
import { loadJson, type AesSuite, type GcmVector } from "./helpers.ts";

export const aesSuite = loadJson<AesSuite>("aes-gcm-v1.json");
export const C = aesSuite.constants;
export const VKV = C.vault_key_version;
export const DKV = C.device_key_version;
export const vaultKey = hexToBytes(C.vault_key);
export const masterKey = hexToBytes(C.master_key);
export const deviceKey = hexToBytes(C.device_key);
export const recoveryKey = hexToBytes(C.recovery_key);
export const kdf = kdfParamsFrom(ARGON2ID_PROFILES.ci, hexToBytes(C.kdf.salt));

export function vec(id: string): GcmVector {
  const v = aesSuite.success.find((x) => x.id === id);
  assert.ok(v, id);
  return v;
}

export function tamperVec(id: string): GcmVector {
  const v = aesSuite.tamper.find((x) => x.id === id);
  assert.ok(v, id);
  return v;
}

/**
 * The exact snapshot the pinned vectors describe: one entry plus a master,
 * device and recovery envelope at `revision` / `vaultKeyVersion`.
 */
export function fixtureSnapshot(): {
  entry: EncryptedEntry;
  master: KeyEnvelope;
  device: KeyEnvelope;
  recovery: KeyEnvelope;
  entries: EncryptedEntry[];
  envelopes: KeyEnvelope[];
  manifest: SnapshotManifest;
} {
  const master = wrapVaultKeyWithNonce({
    vaultKey,
    wrappingKey: masterKey,
    vaultId: C.vault_id,
    type: "master",
    vaultKeyVersion: VKV,
    kdf,
    allowTestProfile: true,
    nonce: hexToBytes(vec("TV-ENV-MASTER").nonce),
  });
  const device = wrapVaultKeyWithNonce({
    vaultKey,
    wrappingKey: deviceKey,
    vaultId: C.vault_id,
    type: "device",
    vaultKeyVersion: VKV,
    deviceId: C.device_id,
    deviceKeyVersion: DKV,
    nonce: hexToBytes(vec("TV-ENV-DEVICE").nonce),
  });
  const recovery = wrapVaultKeyWithNonce({
    vaultKey,
    wrappingKey: recoveryKey,
    vaultId: C.vault_id,
    type: "recovery",
    vaultKeyVersion: VKV,
    nonce: hexToBytes(vec("TV-ENV-RECOVERY").nonce),
  });
  const entryVector = vec("TV-ENTRY-01");
  const entry = encryptEntryWithNonce({
    vaultKey,
    vaultId: C.vault_id,
    entryId: C.entry_id,
    vaultKeyVersion: VKV,
    plaintext: new TextEncoder().encode(entryVector.notes?.plaintext_utf8 ?? ""),
    nonce: hexToBytes(entryVector.nonce),
  });
  const entries = [entry];
  const envelopes = [master, device, recovery];
  const manifest = buildManifest({
    vaultId: C.vault_id,
    revision: C.revision,
    vaultKeyVersion: VKV,
    entries,
    envelopes,
    allowTestProfile: true,
  });
  return { entry, master, device, recovery, entries, envelopes, manifest };
}

export function fixtureSealedManifest(manifest: SnapshotManifest) {
  return sealManifestWithNonce({
    vaultKey,
    manifest,
    nonce: hexToBytes(vec("TV-MANIFEST-01").nonce),
  });
}
