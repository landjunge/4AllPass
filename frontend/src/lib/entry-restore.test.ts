/**
 * Single-entry restore from a superseded revision (P0 #279, "Papierkorb"
 * preparation). Real crypto roundtrips with a stubbed server, in the same shape
 * as vault-session.history.test.ts and vault-session.head-recovery.test.ts.
 */
import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  IntegrityError,
  bytesToBase64,
  buildManifest,
  deriveMasterKey,
  encodeVaultSnapshot,
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

import { api, ApiError } from "./api.ts";
import { emptyDraft, encodeEntryPlaintext, type VaultEntry } from "./entries.ts";
import { EntryAlreadyPresentError, resolveSingleEntryRestore } from "./entry-restore.ts";
import { clearTestStorage } from "./test-storage-shim.ts";
import { loadPin, savePin } from "./revision-pin.ts";
import { CommitConflict, HistoricRevisionUnreadable, commitEntries, type UnlockedVault } from "./vault-session.ts";

const PASSWORD = "entry-restore-master-password";
const profile = ARGON2ID_PROFILES.mobile_safe;
const VAULT_ID = "88888888-8888-4888-8888-888888888888";

const originalGetRevision = api.getRevision.bind(api);
const originalCommit = api.commitSnapshot.bind(api);

afterEach(() => {
  clearTestStorage();
  api.getRevision = originalGetRevision;
  api.commitSnapshot = originalCommit;
});

const vaultKey = generateVaultKey();
const salt = generateSalt(16);
const masterKey = deriveMasterKey(PASSWORD, salt, profile);

function entry(partial: Partial<VaultEntry> & { id: string }): VaultEntry {
  return {
    ...emptyDraft("web"),
    id: partial.id,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function master() {
  return wrapVaultKey({
    vaultKey,
    wrappingKey: masterKey,
    vaultId: VAULT_ID,
    type: "master",
    vaultKeyVersion: 1,
    kdf: kdfParamsFrom(profile, salt),
  });
}

function sealEntries(entries: readonly VaultEntry[]): EncryptedEntry[] {
  return entries.map((entry) => {
    const plaintext = encodeEntryPlaintext(entry);
    try {
      return encryptEntry({
        vaultKey,
        vaultId: VAULT_ID,
        entryId: entry.id,
        plaintext,
        vaultKeyVersion: 1,
        schemaVersion: 1,
      });
    } finally {
      zeroize(plaintext);
    }
  });
}

function historicSnapshot(revision: number, entries: readonly VaultEntry[]) {
  const envelopes = [master()];
  const encrypted = sealEntries(entries);
  return {
    vaultId: VAULT_ID,
    revision,
    vaultKeyVersion: 1 as const,
    cryptoProtocolVersion: 1 as const,
    envelopes,
    entries: encrypted,
    sealedManifest: sealManifest({
      vaultKey,
      manifest: buildManifest({
        vaultId: VAULT_ID,
        revision,
        vaultKeyVersion: 1,
        envelopes,
        entries: encrypted,
      }),
    }),
  };
}

function unlockedVault(revision: number, entries: readonly VaultEntry[]): UnlockedVault {
  return {
    vaultId: VAULT_ID,
    revision,
    vaultKeyVersion: 1,
    vaultKey,
    envelopes: [master()],
    entries: [...entries],
    unlockedWith: "master_password",
  };
}

/** A selection matching what `openHistoricSnapshot` returns for `snapshot`. */
function selectionFor(snapshot: ReturnType<typeof historicSnapshot>) {
  return {
    vaultId: VAULT_ID,
    revision: snapshot.revision,
    vaultKeyVersion: 1,
    manifestDigest: bytesToBase64(sealedManifestDigest(snapshot.sealedManifest)),
  };
}

const CURRENT = entry({ id: "entry-live", title: "Live", username: "a", host: "live.example", password: "live-secret" });
const MISSING = entry({ id: "entry-missing", title: "Missing", username: "b", host: "missing.example", password: "missing-secret" });
const OTHER = entry({ id: "entry-other", title: "Other", username: "c", host: "other.example", password: "other-secret" });

test("resolveSingleEntryRestore restores exactly the selected entry and not the others", async () => {
  const vault = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING, OTHER]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);

  const next = await resolveSingleEntryRestore(vault, selectionFor(snapshot), MISSING.id);

  const ids = next.map((row) => row.id).sort();
  assert.deepEqual(ids, ["entry-live", "entry-missing"]);
  assert.equal(next.find((row) => row.id === "entry-missing")?.password, "missing-secret");
  // The non-selected historical entry is never part of the restored list.
  assert.equal(next.some((row) => row.id === "entry-other"), false);
});

test("a single-entry restore commits forward as a new revision", async () => {
  const vault = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);
  api.commitSnapshot = async (vaultId, payload) => ({ ...payload, vaultId });

  const next = await resolveSingleEntryRestore(vault, selectionFor(snapshot), MISSING.id);
  const committed = await commitEntries(vault, next);

  assert.equal(committed.revision, 6);
  assert.equal(committed.entries.some((row) => row.id === "entry-missing"), true);
  assert.equal(committed.entries.some((row) => row.id === "entry-live"), true);
});

test("resolveSingleEntryRestore rejects an id that already exists", async () => {
  const vault = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);

  await assert.rejects(
    () => resolveSingleEntryRestore(vault, selectionFor(snapshot), CURRENT.id),
    EntryAlreadyPresentError,
  );
});

test("resolveSingleEntryRestore rejects an id absent from the selected revision", async () => {
  const vault = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);

  await assert.rejects(
    () => resolveSingleEntryRestore(vault, selectionFor(snapshot), "entry-ghost"),
    IntegrityError,
  );
});

test("resolveSingleEntryRestore refuses a revision sealed under an earlier vault key", async () => {
  // The vault advanced to Vault-Key generation 2 (e.g. hard revoke); the
  // revision is still generation 1. Restore must refuse, never fetch the old key.
  const vault = { ...unlockedVault(5, [CURRENT]), vaultKeyVersion: 2 };
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);
  const selection = {
    vaultId: VAULT_ID,
    revision: 3,
    vaultKeyVersion: 1,
    manifestDigest: bytesToBase64(sealedManifestDigest(snapshot.sealedManifest)),
  };
  await assert.rejects(() => resolveSingleEntryRestore(vault, selection, MISSING.id), HistoricRevisionUnreadable);
});

test("resolveSingleEntryRestore rejects a source that no longer matches the selection", async () => {
  const vault = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  const selection = selectionFor(snapshot);
  // The server now serves different bytes for the same revision.
  const changed = historicSnapshot(3, [CURRENT, MISSING, OTHER]);
  api.getRevision = async () => encodeVaultSnapshot(changed);

  await assert.rejects(() => resolveSingleEntryRestore(vault, selection, MISSING.id), IntegrityError);
});

test("a single-entry restore commit keeps the CAS conflict contract", async () => {
  const vault = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);
  api.commitSnapshot = async () => {
    throw new ApiError(409, { currentRevision: 6 });
  };

  const next = await resolveSingleEntryRestore(vault, selectionFor(snapshot), MISSING.id);
  await assert.rejects(() => commitEntries(vault, next), CommitConflict);
});

test("resolveSingleEntryRestore leaves the freshness pin alone", async () => {
  const vault = unlockedVault(5, [CURRENT]);
  const snapshot = historicSnapshot(3, [CURRENT, MISSING]);
  api.getRevision = async () => encodeVaultSnapshot(snapshot);
  const pinned = { vaultId: VAULT_ID, revision: 5, vaultKeyVersion: 1, cryptoProtocolVersion: 1 as const };
  savePin(pinned);

  await resolveSingleEntryRestore(vault, selectionFor(snapshot), MISSING.id);

  assert.deepEqual(loadPin(VAULT_ID), pinned);
});
