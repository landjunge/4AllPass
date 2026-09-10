/**
 * Reading a superseded revision must stay a read.
 *
 * The freshness pin is what refuses a rollback (`assertFreshSnapshot`). If
 * opening history moved that pin, "look at an older state" would silently
 * become "accept an older state", so these tests pin that down.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  IntegrityError,
  buildManifest,
  deriveMasterKey,
  encryptEntry,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  sealManifest,
  sealedManifestDigest,
  wrapVaultKey,
  zeroize,
  type EncryptedEntry,
} from "@4allpass/crypto";

import { encodeEntryPlaintext, type VaultEntry } from "./entries.ts";
import { loadPin, savePin } from "./revision-pin.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import {
  HistoricRevisionUnreadable,
  openHistoricEntries,
  type UnlockedVault,
} from "./vault-session.ts";

const PASSWORD = "history-master-password";
const profile = ARGON2ID_PROFILES.mobile_safe;

afterEach(() => {
  clearTestStorage();
});

const ENTRY: VaultEntry = {
  id: "entry-1",
  title: "GitHub",
  username: "ada@example.com",
  password: "s3cret-history-value",
  url: "https://github.com",
  notes: "",
  kind: "web",
  providerId: "",
  totpSecret: "",
  favorite: false,
};

function sealEntries(
  vaultId: string,
  vaultKey: Uint8Array,
  vaultKeyVersion: number,
  entries: readonly VaultEntry[],
): EncryptedEntry[] {
  return entries.map((entry) => {
    const plaintext = encodeEntryPlaintext(entry);
    try {
      return encryptEntry({
        vaultKey,
        vaultId,
        entryId: entry.id,
        plaintext,
        vaultKeyVersion,
        schemaVersion: 1,
      });
    } finally {
      zeroize(plaintext);
    }
  });
}

function historicSnapshot(
  vaultId: string,
  vaultKey: Uint8Array,
  revision: number,
  vaultKeyVersion: number,
  entries: readonly VaultEntry[],
) {
  const salt = generateSalt(16);
  const masterKey = deriveMasterKey(PASSWORD, salt, profile);
  const master = wrapVaultKey({
    vaultKey,
    wrappingKey: masterKey,
    vaultId,
    type: "master",
    vaultKeyVersion,
    kdf: kdfParamsFrom(profile, salt),
  });
  const encrypted = sealEntries(vaultId, vaultKey, vaultKeyVersion, entries);
  return {
    vaultId,
    revision,
    vaultKeyVersion,
    cryptoProtocolVersion: 1 as const,
    envelopes: [master],
    entries: encrypted,
    sealedManifest: sealManifest({
      vaultKey,
      manifest: buildManifest({
        vaultId,
        revision,
        vaultKeyVersion,
        envelopes: [master],
        entries: encrypted,
      }),
    }),
  };
}

function unlockedVault(vaultId: string, vaultKey: Uint8Array, revision: number): UnlockedVault {
  return {
    vaultId,
    revision,
    vaultKeyVersion: 1,
    vaultKey,
    envelopes: [],
    entries: [],
    unlockedWith: "master_password",
  };
}

test("openHistoricEntries decrypts an older revision without moving the pin", () => {
  const vaultId = "11111111-1111-4111-8111-111111111111";
  const vaultKey = generateVaultKey();
  const vault = unlockedVault(vaultId, vaultKey, 7);
  const live = historicSnapshot(vaultId, vaultKey, 7, 1, [ENTRY]);
  const pinned = {
    vaultId,
    revision: 7,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1 as const,
    manifestDigest: sealedManifestDigest(live.sealedManifest),
  };
  savePin(pinned);

  const recovered = openHistoricEntries(
    historicSnapshot(vaultId, vaultKey, 3, 1, [ENTRY]),
    vault,
  );

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.title, "GitHub");
  assert.equal(recovered[0]?.password, "s3cret-history-value");

  // The whole point: revision 3 was read, revision 7 is still what we trust.
  assert.deepEqual(loadPin(vaultId), pinned);
});

test("openHistoricEntries refuses a revision sealed under an earlier vault key", () => {
  const vaultId = "22222222-2222-4222-8222-222222222222";
  const vaultKey = generateVaultKey();
  const older = generateVaultKey();
  const vault = unlockedVault(vaultId, vaultKey, 9);

  assert.throws(
    () => openHistoricEntries(historicSnapshot(vaultId, older, 2, 1, [ENTRY]), {
      ...vault,
      vaultKeyVersion: 2,
    }),
    HistoricRevisionUnreadable,
  );
});

test("openHistoricEntries refuses a snapshot from another vault", () => {
  const vaultKey = generateVaultKey();
  const vault = unlockedVault("33333333-3333-4333-8333-333333333333", vaultKey, 4);
  const foreign = historicSnapshot("44444444-4444-4444-8444-444444444444", vaultKey, 2, 1, [ENTRY]);

  assert.throws(() => openHistoricEntries(foreign, vault), IntegrityError);
});

test("openHistoricEntries refuses a tampered older revision", () => {
  const vaultId = "55555555-5555-4555-8555-555555555555";
  const vaultKey = generateVaultKey();
  const vault = unlockedVault(vaultId, vaultKey, 6);
  const snapshot = historicSnapshot(vaultId, vaultKey, 2, 1, [ENTRY]);

  // Same manifest, one entry dropped: history must fail closed like the live
  // open path does, not quietly hand back a shortened list.
  const tampered = { ...snapshot, entries: [] };

  assert.throws(() => openHistoricEntries(tampered, vault), IntegrityError);
});

test("a failed history read still leaves the pin alone", () => {
  const vaultId = "66666666-6666-4666-8666-666666666666";
  const vaultKey = generateVaultKey();
  const vault = unlockedVault(vaultId, vaultKey, 5);
  const live = historicSnapshot(vaultId, vaultKey, 5, 1, [ENTRY]);
  const pinned = {
    vaultId,
    revision: 5,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1 as const,
    manifestDigest: sealedManifestDigest(live.sealedManifest),
  };
  savePin(pinned);

  const snapshot = historicSnapshot(vaultId, vaultKey, 2, 1, [ENTRY]);
  assert.throws(() => openHistoricEntries({ ...snapshot, entries: [] }, vault), IntegrityError);

  assert.deepEqual(loadPin(vaultId), pinned);
});
