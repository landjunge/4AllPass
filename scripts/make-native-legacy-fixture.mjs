#!/usr/bin/env node
/**
 * Test-only: generate one synthetic manifestless legacy wire for the native
 * throwaway backend. No real vault, key or profile. Run with:
 *   node --import tsx scripts/make-native-legacy-fixture.mjs <vaultId> <password> <out.json>
 */
import { writeFileSync } from "node:fs";
import {
  ARGON2ID_PROFILES,
  deriveMasterKey,
  encodeVaultSnapshot,
  encryptEntry,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  wrapVaultKey,
  zeroize,
} from "@4allpass/crypto";
import {
  emptyDraft,
  encodeEntryPlaintext,
  type VaultEntry,
} from "../frontend/src/modules/entries/index.ts";

const [vaultId, password, out] = process.argv.slice(2);
if (!vaultId || !password || !out) {
  throw new Error("usage: make-native-legacy-fixture.mjs <vaultId> <password> <out.json>");
}

const profile = ARGON2ID_PROFILES.mobile_safe;
const salt = generateSalt(16);
const masterKey = deriveMasterKey(password, salt, profile);
const vaultKey = generateVaultKey();
try {
  const masterEnvelope = wrapVaultKey({
    vaultKey,
    wrappingKey: masterKey,
    vaultId,
    type: "master",
    vaultKeyVersion: 1,
    kdf: kdfParamsFrom(profile, salt),
  });
  const item: VaultEntry = {
    ...emptyDraft("web"),
    id: "native-legacy-entry-1",
    title: "Native legacy fixture",
    username: "synthetic@example.invalid",
    password: "synthetic-legacy-password",
    updatedAt: "2026-11-13T00:00:00Z",
  };
  const plaintext = encodeEntryPlaintext(item);
  let entry;
  try {
    entry = encryptEntry({
      vaultKey,
      vaultId,
      entryId: item.id,
      vaultKeyVersion: 1,
      schemaVersion: 1,
      plaintext,
    });
  } finally {
    zeroize(plaintext);
  }
  const wire = encodeVaultSnapshot({
    vaultId,
    revision: 1,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1,
    entries: [entry],
    envelopes: [masterEnvelope],
  });
  writeFileSync(out, JSON.stringify(wire, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ vaultId, revision: wire.revision, entries: wire.entries.length }));
} finally {
  zeroize(masterKey, vaultKey);
}
